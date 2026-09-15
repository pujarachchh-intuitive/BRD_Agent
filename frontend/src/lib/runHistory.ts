// Run history persisted in localStorage — ported 1:1 from webapp/static/app.js.

import { BackendRunSummary, RunHistoryEntry } from "./types";

const RUN_HISTORY_KEY = "brdAgentSuite.runHistory";

export function loadRunHistory(): RunHistoryEntry[] {
  try {
    const raw = localStorage.getItem(RUN_HISTORY_KEY);
    return raw ? (JSON.parse(raw) as RunHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function saveRunHistory(list: RunHistoryEntry[]): void {
  try {
    localStorage.setItem(RUN_HISTORY_KEY, JSON.stringify(list));
  } catch {
    // localStorage unavailable (private mode, etc.) — history just won't persist.
  }
}

export function addRunToHistory(entry: Omit<RunHistoryEntry, "created_at">): RunHistoryEntry[] {
  const list = loadRunHistory();
  list.unshift({ ...entry, created_at: new Date().toISOString() });
  const trimmed = list.slice(0, 50);
  saveRunHistory(trimmed);
  return trimmed;
}

/** GET /api/runs lists every run ever written to disk — by this webapp's form or by `adk
 * web`/`adk run` directly — so it's the authoritative source for "every previous run," in the
 * backend's newest-first order. localStorage only ever covers runs made through this webapp, but
 * it's the sole source of the parent/revision link (never persisted server-side), so it's used here
 * just to enrich matching entries with that — not to add or reorder anything. */
export function mergeRunHistory(backendRuns: BackendRunSummary[], localHistory: RunHistoryEntry[]): RunHistoryEntry[] {
  const localByRunId = new Map(localHistory.map((entry) => [entry.run_id, entry]));
  return backendRuns.map((run) => {
    const local = localByRunId.get(run.run_id);
    return {
      run_id: run.run_id,
      project_name: run.project_name ?? local?.project_name ?? null,
      parent_run_id: local?.parent_run_id ?? null,
      created_at: local?.created_at ?? "",
    };
  });
}
