import { ConsistencyStats } from "@/lib/dashboardStats";

// A single ratio against a limit is a meter, not a chart — see dataviz skill's choosing-a-form.
export default function ConsistencyMeter({ stats }: { stats: ConsistencyStats }) {
  if (stats.total === 0 || stats.rate == null) {
    return (
      <p className="py-10 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
        No consistency check results yet.
      </p>
    );
  }

  const pct = Math.round(stats.rate * 100);

  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold" style={{ color: "var(--color-text)" }}>
          {pct}%
        </span>
        <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          {stats.passed} of {stats.total} runs passed with no contradictions
        </span>
      </div>
      <div
        className="mt-3 h-3 w-full overflow-hidden rounded-full"
        style={{ background: "var(--color-success-bg)" }}
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Consistency check pass rate"
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: "var(--color-success-fill)", transition: "width 0.3s ease" }}
        />
      </div>
    </div>
  );
}
