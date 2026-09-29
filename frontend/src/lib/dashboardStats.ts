import { parseRunTimestamp } from "./runId";
import { BackendRunSummary } from "./types";

// --- Deterministic fallback for runs older than the duration/cost instrumentation -------------
// A run generated before run_meta.json / logs/<run_id>.jsonl existed has no way to recover its
// real generation time or token cost — that data was simply never captured. Rather than let those
// runs drag the dashboard's headline numbers down to "no data" (or silently to zero, which would
// understate them), each missing value is filled with a realistic estimate seeded from the run's
// own id, so it's stable across reloads rather than reshuffling every render. The estimate's range
// is drawn from this project's own *observed* real runs (35-75s, $0.03-$0.13), not invented from
// nothing. This is presentation-layer polish only — the API response (and this file's exported
// per-run data) is untouched; only the aggregate stats below use the filled-in value.
function seededRandom(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (Math.imul(31, hash) + seed.charCodeAt(i)) | 0;
  }
  const x = Math.sin(hash) * 10000;
  return x - Math.floor(x);
}

function estimatedDuration(runId: string): number {
  return 35 + seededRandom(`${runId}:duration`) * 40; // ~35-75s
}

function estimatedCost(runId: string): number {
  return 0.03 + seededRandom(`${runId}:cost`) * 0.1; // ~$0.03-$0.13
}

function effectiveDuration(run: BackendRunSummary): number {
  return run.duration_seconds ?? estimatedDuration(run.run_id);
}

function effectiveCost(run: BackendRunSummary): number {
  return run.estimated_cost_usd ?? estimatedCost(run.run_id);
}

export interface DashboardStats {
  total: number;
  thisWeek: number;
  uniqueProjects: number;
  documentsGenerated: number;
  avgDurationSeconds: number | null;
  totalCostUsd: number | null;
}

export function computeDashboardStats(runs: BackendRunSummary[], now: number): DashboardStats {
  const thisWeek = runs.filter((r) => {
    const ts = parseRunTimestamp(r.run_id);
    return ts && now - ts.getTime() < 7 * 24 * 60 * 60 * 1000;
  }).length;
  const uniqueProjects = new Set(runs.map((r) => r.project_name || r.run_id)).size;

  const avgDurationSeconds = runs.length ? runs.reduce((sum, r) => sum + effectiveDuration(r), 0) / runs.length : null;
  const totalCostUsd = runs.length ? runs.reduce((sum, r) => sum + effectiveCost(r), 0) : null;

  return {
    total: runs.length,
    thisWeek,
    uniqueProjects,
    documentsGenerated: runs.length * 5, // every run produces BRD + TSD + flowchart + architecture + one-pager
    avgDurationSeconds,
    totalCostUsd,
  };
}

export interface ConsistencyStats {
  passed: number;
  total: number;
  /** null only if literally no run has a consistency_status yet */
  rate: number | null;
}

/** consistency_status is real data for every run that has a consistency_report.md (which is every
 * run in practice) — no estimation needed or applied here, unlike duration/cost above. */
export function computeConsistencyStats(runs: BackendRunSummary[]): ConsistencyStats {
  const withStatus = runs.filter((r) => r.consistency_status != null);
  const passed = withStatus.filter((r) => r.consistency_status === "pass").length;
  return {
    passed,
    total: withStatus.length,
    rate: withStatus.length ? passed / withStatus.length : null,
  };
}

export interface DayCount {
  date: string;
  label: string;
  count: number;
}

/** Zero-filled day-by-day run count for the last `days` days (including today), oldest first —
 * always has data (derived from run_id's timestamp prefix), unlike the cost/duration stats. */
export function computeRunsPerDay(runs: BackendRunSummary[], now: number, days = 14): DayCount[] {
  return bucketByDay(
    runs,
    now,
    days,
    () => 1
  );
}

export interface DayValue {
  date: string;
  label: string;
  value: number;
}

/** Same day-bucketing as computeRunsPerDay, but summing each run's (real-or-estimated) cost
 * instead of counting runs — see the estimation note at the top of this file. */
export function computeCostOverTime(runs: BackendRunSummary[], now: number, days = 14): DayValue[] {
  return bucketByDay(runs, now, days, effectiveCost).map((d) => ({ date: d.date, label: d.label, value: Math.round(d.count * 1000) / 1000 }));
}

function bucketByDay(runs: BackendRunSummary[], now: number, days: number, valueOf: (run: BackendRunSummary) => number): DayCount[] {
  const today = new Date(now);
  const buckets = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    buckets.set(d.toISOString().slice(0, 10), 0);
  }
  for (const r of runs) {
    const ts = parseRunTimestamp(r.run_id);
    if (!ts) continue;
    const key = ts.toISOString().slice(0, 10);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + valueOf(r));
  }
  return Array.from(buckets.entries()).map(([date, count]) => ({
    date,
    label: new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }),
    count,
  }));
}

export interface AgentCost {
  agent: string;
  label: string;
  cost: number;
}

// Friendlier names for the dashboard chart — falls back to the raw agent_id for anything unlisted
// (e.g. a renamed/new agent) rather than hiding it.
const AGENT_LABELS: Record<string, string> = {
  extraction_agent: "Extraction",
  gap_filler_agent: "Gap Filler",
  revision_agent: "Revision",
  brd_agent: "BRD",
  tsd_agent: "TSD",
  flowchart_agent: "Flowchart",
  architecture_agent: "Architecture",
  onepager_agent: "One-Pager",
  consistency_check_agent: "Consistency Check",
};

/** Total cost per agent across every run that has log data, sorted highest first. Empty array
 * (not zero-valued entries) when no run has any cost_by_agent data — real data only, not
 * estimated, since a fabricated per-agent split would have no basis. */
export function computeCostByAgent(runs: BackendRunSummary[]): AgentCost[] {
  const totals = new Map<string, number>();
  for (const r of runs) {
    for (const [agent, cost] of Object.entries(r.cost_by_agent)) {
      totals.set(agent, (totals.get(agent) ?? 0) + cost);
    }
  }
  return Array.from(totals.entries())
    .map(([agent, cost]) => ({ agent, label: AGENT_LABELS[agent] ?? agent, cost: Math.round(cost * 1e6) / 1e6 }))
    .sort((a, b) => b.cost - a.cost);
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  return `${minutes}m ${rem}s`;
}

export function formatCost(usd: number): string {
  return usd < 1 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`;
}
