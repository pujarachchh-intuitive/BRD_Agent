import { DraftRepeaterRow, emptyDraftRow } from "@/lib/formLogic";
import { ListObjFieldDef } from "@/lib/types";

interface RepeaterFieldProps {
  def: ListObjFieldDef;
  rows: DraftRepeaterRow[];
  disabled: boolean;
  onChange: (rows: DraftRepeaterRow[]) => void;
}

export default function RepeaterField({ def, rows, disabled, onChange }: RepeaterFieldProps) {
  function updateCell(index: number, subfieldName: string, value: string) {
    const next = rows.map((row, i) => (i === index ? { ...row, [subfieldName]: value } : row));
    onChange(next);
  }

  function removeRow(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }

  function addRow() {
    onChange([...rows, emptyDraftRow(def)]);
  }

  return (
    <>
      <div className="repeater-rows">
        {rows.map((row, index) => (
          <div className="repeater-row" key={index}>
            {def.subfields.map((sf) => (
              <div className="repeater-cell" key={sf.name}>
                <label htmlFor={`field-${def.label}-${index}-${sf.name}`}>{sf.label}</label>
                {sf.type === "select" ? (
                  <select
                    id={`field-${def.label}-${index}-${sf.name}`}
                    className="field-input cursor-pointer"
                    value={row[sf.name] ?? sf.default ?? ""}
                    disabled={disabled}
                    onChange={(e) => updateCell(index, sf.name, e.target.value)}
                  >
                    {(sf.options ?? []).map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : sf.type === "textarea" ? (
                  <textarea
                    id={`field-${def.label}-${index}-${sf.name}`}
                    className="field-input"
                    rows={3}
                    placeholder={sf.placeholder}
                    value={row[sf.name] ?? ""}
                    disabled={disabled}
                    onChange={(e) => updateCell(index, sf.name, e.target.value)}
                    // A browser extension (form-fill/security tool) stamps island_* attributes
                    // onto text fields before React hydrates — not something our code causes.
                    suppressHydrationWarning
                  />
                ) : (
                  <input
                    id={`field-${def.label}-${index}-${sf.name}`}
                    type="text"
                    className="field-input"
                    placeholder={sf.placeholder}
                    value={row[sf.name] ?? ""}
                    disabled={disabled}
                    onChange={(e) => updateCell(index, sf.name, e.target.value)}
                    suppressHydrationWarning
                  />
                )}
              </div>
            ))}
            <button
              type="button"
              className="btn-remove"
              title="Remove row"
              aria-label="Remove row"
              disabled={disabled}
              onClick={() => removeRow(index)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-secondary btn-small" disabled={disabled} onClick={addRow}>
        + Add
      </button>
    </>
  );
}
