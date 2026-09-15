import { marked } from "marked";

export default function ConsistencyPanel({ reportMd }: { reportMd: string | null }) {
  if (!reportMd) return null;

  const head = reportMd.slice(0, 400);
  const looksClean = /\bPASS\b/i.test(head) || /no contradictions/i.test(head);
  const html = marked.parse(reportMd, { async: false }) as string;

  return (
    <div
      className="panel mb-5"
      style={
        looksClean
          ? { background: "var(--color-success-bg)", borderColor: "var(--color-success-border)" }
          : { background: "var(--color-warn-bg)", borderColor: "var(--color-warn-border)" }
      }
    >
      <h2 style={{ color: looksClean ? "var(--color-success-text)" : "var(--color-warn-text)" }}>Consistency Check</h2>
      <div className="markdown-body prose prose-slate [&>*:first-child]:mt-0" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
