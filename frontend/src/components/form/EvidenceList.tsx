import { CheckCircle2, CircleHelp, TriangleAlert } from "lucide-react";
import { Evidence } from "@/lib/types";

/** The quotes a field's extracted value came from, each marked with whether it was found word
 * for word in the source (null: a scanned PDF, which can't be checked). */
export default function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  return (
    <details className="evidence-list">
      <summary>
        Sources ({evidence.length})
      </summary>
      <ul>
        {evidence.map((item, index) => (
          <li key={index}>
            <blockquote>&ldquo;{item.quote}&rdquo;</blockquote>
            <span className="evidence-meta">
              {item.verified === true && <CheckCircle2 size={13} aria-hidden style={{ color: "var(--color-success-fill)" }} />}
              {item.verified === false && <TriangleAlert size={13} aria-hidden style={{ color: "var(--color-warn-text)" }} />}
              {item.verified === null && <CircleHelp size={13} aria-hidden />}
              {item.file}
              {item.location ? ` · ${item.location}` : ""}
              {item.verified === false && " · quote not found in the document"}
              {item.verified === null && " · scanned file, quote not checked"}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
