import { RunResult } from "@/lib/types";

export default function RunBadge({ data }: { data: RunResult }) {
  return (
    <div className="mb-4 text-sm" style={{ color: "var(--color-text-muted)" }}>
      Run: {data.run_id}
      {data.parent_run_id ? ` (revised from ${data.parent_run_id})` : ""}
    </div>
  );
}
