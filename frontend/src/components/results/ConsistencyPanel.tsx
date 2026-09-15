import { CheckCircle2, AlertTriangle } from "lucide-react";
import { marked } from "marked";

export default function ConsistencyPanel({ reportMd }: { reportMd: string | null }) {
  if (!reportMd) return null;

  const head = reportMd.slice(0, 400);
  const looksClean = /\bPASS\b/i.test(head) || /no contradictions/i.test(head);
  const html = marked.parse(reportMd, { async: false }) as string;

  return (
    <details className="card mb-5 px-5 py-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-semibold" style={{ color: "var(--color-text)" }}>
          Consistency check
        </span>
        <span className={`chip ${looksClean ? "chip-success" : "chip-warn"}`}>
          {looksClean ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
          {looksClean ? "Passed" : "Needs review"}
        </span>
      </summary>
      <div className="markdown-body prose prose-slate prose-sm mt-3 [&>*:first-child]:mt-0" dangerouslySetInnerHTML={{ __html: html }} />
    </details>
  );
}
