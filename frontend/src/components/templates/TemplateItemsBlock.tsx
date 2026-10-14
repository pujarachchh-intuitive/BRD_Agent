"use client";

import { Check, Undo2, X } from "lucide-react";
import { AppliedTemplateItem, TemplateItemStatus } from "@/lib/templateLogic";
import { FieldDef } from "@/lib/types";
import { SourceLine, TagChip } from "./TemplateContentView";

interface TemplateItemsBlockProps {
  fieldName: string;
  def: FieldDef;
  templateName: string;
  items: AppliedTemplateItem[];
  disabled: boolean;
  onValuesChange: (key: string, values: Record<string, string>) => void;
  onStatusChange: (key: string, status: TemplateItemStatus) => void;
  onAcceptAll: () => void;
}

const STATUS_LABELS: Record<TemplateItemStatus, string> = {
  pending: "Needs review",
  accepted: "Accepted",
  edited: "Edited",
  rejected: "Removed",
};

/** A field's template suggestions, shown above the user's own entries. Each one must be accepted,
 * edited (which also counts as accepting) or removed before generating. */
export default function TemplateItemsBlock({
  fieldName,
  def,
  templateName,
  items,
  disabled,
  onValuesChange,
  onStatusChange,
  onAcceptAll,
}: TemplateItemsBlockProps) {
  const pending = items.filter((i) => i.status === "pending").length;

  return (
    <div className="template-items" aria-label={`Suggestions from the ${templateName} template`}>
      <div className="template-items-header">
        <span>
          From the <strong>{templateName}</strong> template
          {pending > 0 ? ` · ${pending} to review` : " · all reviewed"}
        </span>
        {pending > 1 && (
          <button type="button" className="btn btn-ghost btn-small" disabled={disabled} onClick={onAcceptAll}>
            <Check size={14} /> Accept all {pending}
          </button>
        )}
      </div>

      {items.map((item) => {
        const inputId = (name: string) => `tpl-${fieldName}-${item.key}-${name}`;
        if (item.status === "rejected") {
          return (
            <div key={item.key} className="template-item is-rejected" id={`template-item-${item.key}`}>
              <span className="template-item-removed-text">
                Removed: {def.kind === "list_obj" ? item.values[def.subfields[0].name] : item.values.text}
              </span>
              <button type="button" className="btn btn-ghost btn-small" disabled={disabled} onClick={() => onStatusChange(item.key, "pending")}>
                <Undo2 size={14} /> Undo
              </button>
            </div>
          );
        }
        return (
          <div key={item.key} className={`template-item is-${item.status}`} id={`template-item-${item.key}`}>
            <div className="template-item-top">
              <span className={`template-item-status status-${item.status}`}>
                {item.status === "pending" ? <span className="template-item-dot" /> : <Check size={13} />}
                {STATUS_LABELS[item.status]}
              </span>
              <TagChip tag={item.tag} />
            </div>

            <div className="template-item-fields">
              {def.kind === "list_obj" ? (
                def.subfields.map((sf) => (
                  <div className="repeater-cell" key={sf.name}>
                    <label htmlFor={inputId(sf.name)}>{sf.label}</label>
                    {sf.type === "select" ? (
                      <select
                        id={inputId(sf.name)}
                        className="field-input cursor-pointer"
                        value={item.values[sf.name] ?? sf.default ?? ""}
                        disabled={disabled}
                        onChange={(e) => onValuesChange(item.key, { ...item.values, [sf.name]: e.target.value })}
                      >
                        {(sf.options ?? []).map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <textarea
                        id={inputId(sf.name)}
                        className="field-input template-item-input"
                        rows={1}
                        value={item.values[sf.name] ?? ""}
                        disabled={disabled}
                        onChange={(e) => onValuesChange(item.key, { ...item.values, [sf.name]: e.target.value })}
                        suppressHydrationWarning
                      />
                    )}
                  </div>
                ))
              ) : (
                <div className="repeater-cell">
                  <textarea
                    id={inputId("text")}
                    aria-label={`${def.label} suggestion`}
                    className="field-input template-item-input"
                    rows={1}
                    value={item.values.text ?? ""}
                    disabled={disabled}
                    onChange={(e) => onValuesChange(item.key, { text: e.target.value })}
                    suppressHydrationWarning
                  />
                </div>
              )}
            </div>

            <div className="template-item-bottom">
              <SourceLine source={item.source} url={item.source_url} />
              <span className="flex gap-1.5">
                {item.status === "pending" && (
                  <button type="button" className="btn btn-secondary btn-small" disabled={disabled} onClick={() => onStatusChange(item.key, "accepted")}>
                    <Check size={14} /> Accept
                  </button>
                )}
                <button type="button" className="btn btn-ghost btn-small" disabled={disabled} onClick={() => onStatusChange(item.key, "rejected")}>
                  <X size={14} /> Remove
                </button>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
