import Link from "next/link";
import { FolderOpen, GitBranch } from "lucide-react";
import { formatRelativeTime, parseRunTimestamp } from "@/lib/runId";
import { BackendRunSummary } from "@/lib/types";

interface RunCardProps {
  run: BackendRunSummary;
  /** True for a run reached via another run's parent_run_id — shows a revision icon/badge instead
   * of treating it as a standalone request. */
  isRevision?: boolean;
}

export default function RunCard({ run, isRevision = false }: RunCardProps) {
  const ts = parseRunTimestamp(run.run_id);
  return (
    <Link href={`/runs/${run.run_id}`} className="run-card">
      <div className="run-card-main">
        <div className="run-card-icon">{isRevision ? <GitBranch size={15} /> : <FolderOpen size={17} />}</div>
        <div className="min-w-0">
          <div className="run-card-title">{run.project_name || run.run_id}</div>
          <div className="run-card-meta">{run.run_id}</div>
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        {isRevision && <span className="chip chip-neutral">Revision</span>}
        <span className="chip chip-neutral whitespace-nowrap">{formatRelativeTime(ts)}</span>
      </div>
    </Link>
  );
}
