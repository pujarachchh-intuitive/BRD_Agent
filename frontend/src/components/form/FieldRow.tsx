import { DraftRepeaterRow } from "@/lib/formLogic";
import { AppliedTemplateItem, TemplateItemStatus } from "@/lib/templateLogic";
import { FieldDef, FieldReview } from "@/lib/types";
import TemplateItemsBlock from "@/components/templates/TemplateItemsBlock";
import EvidenceList from "./EvidenceList";
import RepeaterField from "./RepeaterField";

/** This field's suggestions from the template the form was started from. */
export interface FieldTemplateProps {
  templateName: string;
  items: AppliedTemplateItem[];
  onValuesChange: (key: string, values: Record<string, string>) => void;
  onStatusChange: (key: string, status: TemplateItemStatus) => void;
  onAcceptAll: () => void;
}

interface FieldRowProps {
  name: string;
  def: FieldDef;
  value: string | DraftRepeaterRow[];
  isAuto: boolean;
  isExcluded: boolean;
  disabled: boolean;
  /** Review mode only: what the document extraction found for this field. */
  review?: FieldReview;
  /** Just the editor: no auto-generate / not-applicable checkboxes. */
  hideToggles?: boolean;
  template?: FieldTemplateProps;
  onValueChange: (value: string | DraftRepeaterRow[]) => void;
  onToggleAuto?: (checked: boolean) => void;
  onToggleExclude?: (checked: boolean) => void;
}

const REVIEW_BADGES: Record<string, { label: string; className: string }> = {
  found: { label: "From your documents", className: "chip chip-success" },
  confirm: { label: "Please check", className: "chip chip-warn" },
  blocking: { label: "Needs your input", className: "chip chip-error" },
  auto: { label: "AI will draft", className: "chip" },
};

export default function FieldRow({
  name,
  def,
  value,
  isAuto,
  isExcluded,
  disabled,
  review,
  hideToggles,
  template,
  onValueChange,
  onToggleAuto,
  onToggleExclude,
}: FieldRowProps) {
  const isRequired = def.critical || def.noExclude;
  const showAuto = !hideToggles && !def.critical && !def.skipToggles;
  const showExclude = showAuto && !def.noExclude;
  const inputsDisabled = disabled || isExcluded;
  const badge = review ? REVIEW_BADGES[review.state] : undefined;
  const hasTemplateItems = !!template && template.items.length > 0;
  const templatePending = hasTemplateItems && !isExcluded && template.items.some((i) => i.status === "pending");

  const wrapClasses = [
    "field",
    def.kind === "scalar" && def.prominent ? "field-prominent" : "",
    isAuto ? "is-auto" : "",
    isExcluded ? "is-excluded" : "",
    review ? `review-${review.state}` : "",
    templatePending ? "has-template-pending" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={wrapClasses} id={`field-row-${name}`}>
      <div className="field-header">
        <label className="field-label" htmlFor={def.kind !== "list_obj" ? `field-${name}` : undefined}>
          {def.label}
          {isRequired ? " (required)" : ""}
          {badge && <span className={`${badge.className} ml-2 align-middle`}>{badge.label}</span>}
        </label>
        <div className="field-toggles">
          {showAuto && (
            <label className="auto-toggle">
              <input
                type="checkbox"
                checked={isAuto}
                disabled={disabled}
                onChange={(e) => onToggleAuto?.(e.target.checked)}
              />{" "}
              Auto-generate / enrich
            </label>
          )}
          {showExclude && (
            <label className="exclude-toggle">
              <input
                type="checkbox"
                checked={isExcluded}
                disabled={disabled}
                onChange={(e) => onToggleExclude?.(e.target.checked)}
              />{" "}
              Not applicable — omit this section
            </label>
          )}
        </div>
      </div>

      {def.helper && <p className="field-helper">{def.helper}</p>}
      {review && review.state !== "found" && review.reason && <p className="field-review-reason">{review.reason}</p>}
      {review && review.evidence.length > 0 && <EvidenceList evidence={review.evidence} />}

      {hasTemplateItems && (
        <TemplateItemsBlock
          fieldName={name}
          def={def}
          templateName={template.templateName}
          items={template.items}
          disabled={inputsDisabled}
          onValuesChange={template.onValuesChange}
          onStatusChange={template.onStatusChange}
          onAcceptAll={template.onAcceptAll}
        />
      )}
      {hasTemplateItems && <p className="template-own-label">Your own entries</p>}

      {/* suppressHydrationWarning throughout: a browser extension (form-fill/security tool)
          stamps island_* attributes onto text inputs/textareas before React hydrates — a real DOM
          difference, but not one our code causes or can avoid. */}
      {def.kind === "scalar" &&
        (def.input === "textarea" ? (
          <textarea
            id={`field-${name}`}
            className="field-input"
            rows={def.prominent ? 4 : 3}
            placeholder={def.placeholder}
            value={typeof value === "string" ? value : ""}
            disabled={inputsDisabled}
            onChange={(e) => onValueChange(e.target.value)}
            suppressHydrationWarning
          />
        ) : (
          <input
            id={`field-${name}`}
            type="text"
            className="field-input"
            placeholder={def.placeholder}
            value={typeof value === "string" ? value : ""}
            disabled={inputsDisabled}
            onChange={(e) => onValueChange(e.target.value)}
            suppressHydrationWarning
          />
        ))}

      {def.kind === "list_str" && (
        <textarea
          id={`field-${name}`}
          className="field-input"
          rows={3}
          placeholder="One item per line"
          value={typeof value === "string" ? value : ""}
          disabled={inputsDisabled}
          onChange={(e) => onValueChange(e.target.value)}
          suppressHydrationWarning
        />
      )}

      {def.kind === "list_obj" && (
        <RepeaterField
          def={def}
          rows={Array.isArray(value) ? value : []}
          disabled={inputsDisabled}
          onChange={(rows) => onValueChange(rows)}
        />
      )}
    </div>
  );
}
