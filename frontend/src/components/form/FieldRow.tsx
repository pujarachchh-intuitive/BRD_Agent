import { DraftRepeaterRow } from "@/lib/formLogic";
import { FieldDef } from "@/lib/types";
import RepeaterField from "./RepeaterField";

interface FieldRowProps {
  name: string;
  def: FieldDef;
  value: string | DraftRepeaterRow[];
  isAuto: boolean;
  isExcluded: boolean;
  disabled: boolean;
  onValueChange: (value: string | DraftRepeaterRow[]) => void;
  onToggleAuto: (checked: boolean) => void;
  onToggleExclude: (checked: boolean) => void;
}

export default function FieldRow({ name, def, value, isAuto, isExcluded, disabled, onValueChange, onToggleAuto, onToggleExclude }: FieldRowProps) {
  const isRequired = def.critical || def.noExclude;
  const showAuto = !def.critical && !def.skipToggles;
  const showExclude = showAuto && !def.noExclude;
  const inputsDisabled = disabled || isExcluded;

  const wrapClasses = ["field", def.kind === "scalar" && def.prominent ? "field-prominent" : "", isAuto ? "is-auto" : "", isExcluded ? "is-excluded" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={wrapClasses}>
      <div className="field-header">
        <label className="field-label" htmlFor={def.kind !== "list_obj" ? `field-${name}` : undefined}>
          {def.label}
          {isRequired ? " (required)" : ""}
        </label>
        <div className="field-toggles">
          {showAuto && (
            <label className="auto-toggle">
              <input
                type="checkbox"
                checked={isAuto}
                disabled={disabled}
                onChange={(e) => onToggleAuto(e.target.checked)}
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
                onChange={(e) => onToggleExclude(e.target.checked)}
              />{" "}
              Not applicable — omit this section
            </label>
          )}
        </div>
      </div>

      {def.helper && <p className="field-helper">{def.helper}</p>}

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
