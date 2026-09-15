"use client";

import { useState } from "react";
import { FORM_SECTIONS, FIELD_DEFS } from "@/lib/formConfig";
import { CollectedForm, DraftFormState, collectFormData, emptyDraftState, validateRequiredFields } from "@/lib/formLogic";
import { DraftRepeaterRow } from "@/lib/formLogic";
import { DEMO_DRAFT } from "@/lib/demoData";
import FieldRow from "./FieldRow";

interface RequestFormProps {
  disabled: boolean;
  onSubmit: (collected: CollectedForm) => void;
  onValidationError: (message: string) => void;
  onClearError: () => void;
}

export default function RequestForm({ disabled, onSubmit, onValidationError, onClearError }: RequestFormProps) {
  const [draft, setDraft] = useState<DraftFormState>(emptyDraftState);
  const [autoFields, setAutoFields] = useState<Record<string, boolean>>({});
  const [excludedFields, setExcludedFields] = useState<Record<string, boolean>>({});

  function handleValueChange(name: string, value: string | DraftRepeaterRow[]) {
    setDraft((prev) => ({ ...prev, [name]: value }));
  }

  // Auto-generate and exclude are mutually exclusive: enriching a section and omitting it entirely
  // can't both be true at once.
  function handleToggleAuto(name: string, checked: boolean) {
    if (checked && excludedFields[name]) {
      setExcludedFields((prev) => ({ ...prev, [name]: false }));
    }
    setAutoFields((prev) => ({ ...prev, [name]: checked }));
  }

  function handleToggleExclude(name: string, checked: boolean) {
    if (checked && autoFields[name]) {
      setAutoFields((prev) => ({ ...prev, [name]: false }));
    }
    setExcludedFields((prev) => ({ ...prev, [name]: checked }));
  }

  // For demos: skips typing out a full submission by hand. Fills every field with a complete,
  // realistic example (no auto-generate/exclude flags needed) so Generate Documents can be clicked
  // immediately after.
  function handleFillDemo() {
    onClearError();
    setDraft(DEMO_DRAFT);
    setAutoFields({});
    setExcludedFields({});
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    onClearError();
    const autoSet = new Set(Object.entries(autoFields).filter(([, v]) => v).map(([k]) => k));
    const excludedSet = new Set(Object.entries(excludedFields).filter(([, v]) => v).map(([k]) => k));
    const collected = collectFormData(draft, autoSet, excludedSet);
    const validationError = validateRequiredFields(collected.form, collected.excluded_sections);
    if (validationError) {
      onValidationError(validationError);
      return;
    }
    onSubmit(collected);
  }

  return (
    <section id="form-section">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <p className="m-0" style={{ color: "var(--color-text-muted)" }}>
          Describe your project below. Leave anything blank or tick &quot;Auto-generate&quot; on a field you&apos;d
          rather the AI infer — everything you do fill in is kept exactly as written.
        </p>
        <button type="button" className="btn btn-secondary btn-small whitespace-nowrap" disabled={disabled} onClick={handleFillDemo}>
          Fill Demo Data
        </button>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="flex flex-col gap-3">
          {FORM_SECTIONS.map((section) => (
            <details className="form-section" open key={section.title}>
              <summary>{section.title}</summary>
              <div className="form-section-body">
                {section.fields.map((fieldName) => (
                  <FieldRow
                    key={fieldName}
                    name={fieldName}
                    def={FIELD_DEFS[fieldName]}
                    value={draft[fieldName]}
                    isAuto={!!autoFields[fieldName]}
                    isExcluded={!!excludedFields[fieldName]}
                    disabled={disabled}
                    onValueChange={(value) => handleValueChange(fieldName, value)}
                    onToggleAuto={(checked) => handleToggleAuto(fieldName, checked)}
                    onToggleExclude={(checked) => handleToggleExclude(fieldName, checked)}
                  />
                ))}
              </div>
            </details>
          ))}
        </div>
        <div className="mt-6 flex justify-center">
          <button type="submit" className="btn btn-primary btn-large" disabled={disabled}>
            Generate Documents
          </button>
        </div>
      </form>
    </section>
  );
}
