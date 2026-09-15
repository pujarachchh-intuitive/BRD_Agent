import { FORM_SECTIONS } from "@/lib/formConfig";
import { DraftFormState, isDraftValueFilled } from "@/lib/formLogic";
import { sectionAnchorId } from "@/lib/formSections";

interface SectionNavProps {
  draft: DraftFormState;
}

export default function SectionNav({ draft }: SectionNavProps) {
  return (
    <nav className="form-section-nav" aria-label="Form sections">
      {FORM_SECTIONS.map((section) => {
        const hasContent = section.fields.some((f) => isDraftValueFilled(draft[f]));
        return (
          <a key={section.title} href={`#${sectionAnchorId(section.title)}`} className="form-section-nav-link">
            <span className={`form-section-nav-dot${hasContent ? " filled" : ""}`} />
            {section.title}
          </a>
        );
      })}
    </nav>
  );
}
