import { AlertTriangle, CalendarRange, ListChecks, Target } from "lucide-react";
import { formatRelativeTime, parseRunTimestamp } from "@/lib/runId";
import { RunResult } from "@/lib/types";

export default function SummaryHeader({ data }: { data: RunResult }) {
  const req = data.requirements_json;
  const ts = parseRunTimestamp(data.run_id);
  const counts = {
    objectives: req.objectives?.length ?? 0,
    requirements: req.functional_requirements?.length ?? 0,
    risks: req.risks?.length ?? 0,
    phases: req.timeline_phases?.length ?? 0,
  };

  return (
    <div className="card mb-5 px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="run-card-meta mb-1">
            {data.run_id}
            {data.parent_run_id ? ` · revised from ${data.parent_run_id}` : ""}
          </div>
          <h1 className="m-0 text-xl font-bold" style={{ color: "var(--color-text)" }}>
            {req.project_name || "Untitled project"}
          </h1>
          {ts && (
            <p className="mt-1 mb-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
              Generated {formatRelativeTime(ts)}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="chip">
            <Target size={13} /> {counts.objectives} objectives
          </span>
          <span className="chip">
            <ListChecks size={13} /> {counts.requirements} requirements
          </span>
          {counts.risks > 0 && (
            <span className="chip chip-warn">
              <AlertTriangle size={13} /> {counts.risks} risks
            </span>
          )}
          <span className="chip chip-neutral">
            <CalendarRange size={13} /> {counts.phases} phases
          </span>
        </div>
      </div>
    </div>
  );
}
