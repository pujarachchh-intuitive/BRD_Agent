import { ExternalLink } from "lucide-react";
import { FIELD_DEFS, FORM_SECTIONS } from "@/lib/formConfig";
import { TAG_LABELS } from "@/lib/templateLogic";
import { TemplateContent, TemplateItem, TemplateTag } from "@/lib/types";

const FIELD_ORDER = FORM_SECTIONS.flatMap((s) => s.fields);

export function TagChip({ tag }: { tag: TemplateTag }) {
  return (
    <span className={`chip tag-chip tag-${tag}`} title={tag === "regulatory" ? "Required by a named law, regulation or mandatory standard" : "Widely accepted industry practice, not legally required"}>
      {TAG_LABELS[tag]}
    </span>
  );
}

export function SourceLine({ source, url }: { source: string; url: string | null }) {
  if (!source && !url) return null;
  return (
    <span className="template-source">
      Source: {source || url}
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Open source in a new tab" className="ml-1 inline-flex align-[-2px]">
          <ExternalLink size={12} />
        </a>
      )}
    </span>
  );
}

/** One item's values as a single readable line ("Security — Encrypt ePHI ..."). */
export function itemSummary(field: string, item: Pick<TemplateItem, "values">): { title: string; detail: string } {
  const def = FIELD_DEFS[field];
  if (def.kind !== "list_obj") return { title: item.values.text ?? "", detail: "" };
  const [first, ...rest] = def.subfields.map((sf) => item.values[sf.name] ?? "").filter(Boolean);
  return { title: first ?? "", detail: rest.join(" · ") };
}

interface TemplateContentViewProps {
  content: TemplateContent;
  /** When given, only the items these answers make applicable are shown. */
  answers?: Record<string, boolean>;
  /** Item keys to highlight as added/changed (version comparison). */
  marks?: Record<string, "added" | "changed">;
}

/** Read-only list of a template's items, grouped by form field — used by the user-facing preview
 * and by Template Studio's version viewer. */
export default function TemplateContentView({ content, answers, marks }: TemplateContentViewProps) {
  const fields = FIELD_ORDER.filter((f) => content.items[f]?.length);
  return (
    <div className="flex flex-col gap-4">
      {fields.map((field) => {
        const items = content.items[field].filter((i) => !answers || i.applies_if === null || answers[i.applies_if]);
        if (!items.length) return null;
        return (
          <section key={field}>
            <h3 className="template-view-heading">
              {FIELD_DEFS[field].label} <span className="template-view-count">{items.length}</span>
            </h3>
            <ul className="template-view-list">
              {items.map((item) => {
                const { title, detail } = itemSummary(field, item);
                const question = item.applies_if ? content.questions.find((q) => q.key === item.applies_if) : null;
                return (
                  <li key={item.key} className={marks?.[item.key] ? `is-${marks[item.key]}` : undefined}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="template-view-title">{title}</span>
                      <span className="flex items-center gap-1.5">
                        {marks?.[item.key] && <span className="chip chip-neutral">{marks[item.key] === "added" ? "New" : "Changed"}</span>}
                        <TagChip tag={item.tag} />
                      </span>
                    </div>
                    {detail && <p className="template-view-detail">{detail}</p>}
                    <SourceLine source={item.source} url={item.source_url} />
                    {question && !answers && <span className="template-source">Only if: {question.text}</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {!fields.length && <p className="doc-empty m-0">This template doesn&apos;t pre-fill anything yet.</p>}
    </div>
  );
}
