import { FORM_SECTIONS } from "@/lib/formConfig";
import { DraftFormState, isDraftValueFilled } from "@/lib/formLogic";
import { sectionAnchorId } from "@/lib/formSections";

interface SectionNavProps {
  draft: DraftFormState;
  /** Fields that count as filled because of accepted template items. */
  filledByTemplate?: Set<string>;
  /** Field name -> template items in it still waiting for review. */
  pendingByField?: Record<string, number>;
}

export default function SectionNav({ draft, filledByTemplate, pendingByField }: SectionNavProps) {
  return (
    <nav className="form-section-nav" aria-label="Form sections">
      {FORM_SECTIONS.map((section) => {
        const hasContent = section.fields.some((f) => isDraftValueFilled(draft[f]) || filledByTemplate?.has(f));
        const pending = section.fields.reduce((sum, f) => sum + (pendingByField?.[f] ?? 0), 0);
        return (
          <a key={section.title} href={`#${sectionAnchorId(section.title)}`} className="form-section-nav-link">
            <span className={`form-section-nav-dot${hasContent ? " filled" : ""}`} />
            <span className="flex-1">{section.title}</span>
            {pending > 0 && (
              <span className="nav-pending-count" title={`${pending} template item${pending === 1 ? "" : "s"} to review`}>
                {pending}
              </span>
            )}
          </a>
        );
      })}
    </nav>
  );
}
