"use client";

import { CheckCircle2, CircleAlert, Plus, TriangleAlert } from "lucide-react";
import FieldRow from "@/components/form/FieldRow";
import { RequestFormState } from "@/components/form/useRequestFormState";
import { FIELD_DEFS } from "@/lib/formConfig";
import { applySuggestion } from "@/lib/formLogic";
import { ExtractionConflict, ExtractionResult, GapQuestion } from "@/lib/types";

interface ReviewChecklistProps {
  extraction: ExtractionResult;
  form: RequestFormState;
  isResolved: (field: string) => boolean;
  onAcknowledge: (field: string) => void;
  disabled: boolean;
}

function scrollToField(field: string) {
  document.getElementById(`field-row-${field}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function Suggestions({ question, field, form, disabled }: { question?: GapQuestion; field: string; form: RequestFormState; disabled: boolean }) {
  if (!question?.suggested_answers.length) return null;
  const def = FIELD_DEFS[field];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
        Suggested from your documents:
      </span>
      {question.suggested_answers.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          className="suggestion-chip"
          disabled={disabled}
          onClick={() => form.setValue(field, applySuggestion(def, form.draft[field], suggestion))}
        >
          <Plus size={12} aria-hidden /> {suggestion}
        </button>
      ))}
    </div>
  );
}

function ConflictOptions({ conflict, form, disabled }: { conflict: ExtractionConflict; form: RequestFormState; disabled: boolean }) {
  const def = FIELD_DEFS[conflict.field];
  return (
    <div className="flex flex-col gap-1.5">
      <p className="m-0 text-sm">{conflict.description}</p>
      <div className="flex flex-wrap gap-2">
        {conflict.options.map((option) => (
          <button
            key={`${option.value}-${option.file}`}
            type="button"
            className="suggestion-chip"
            disabled={disabled}
            title={`Use this value (${option.file}${option.location ? `, ${option.location}` : ""})`}
            onClick={() => form.setValue(conflict.field, applySuggestion(def, def.kind === "scalar" ? "" : form.draft[conflict.field], option.value))}
          >
            {option.value}
            <span className="suggestion-chip-source">
              {option.file}
              {option.location ? ` · ${option.location}` : ""}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** The "before you generate" panel: every blocking gap with its question and an inline editor, then
 * every value the user needs to check. Generation stays disabled until each item is resolved. */
export default function ReviewChecklist({ extraction, form, isResolved, onAcknowledge, disabled }: ReviewChecklistProps) {
  const questionsByField = new Map(extraction.gap_questions.map((q) => [q.field, q]));
  const conflictsByField = new Map(extraction.conflicts.map((c) => [c.field, c]));
  const reviews = new Map(extraction.fields.map((f) => [f.field, f]));
  const otherQuestions = extraction.gap_questions.filter(
    (q) => !extraction.blocking.includes(q.field) && !extraction.confirm.includes(q.field) && FIELD_DEFS[q.field]
  );

  if (!extraction.blocking.length && !extraction.confirm.length && !otherQuestions.length) {
    return (
      <div className="panel review-panel review-panel-ok">
        <CheckCircle2 size={18} aria-hidden /> Your documents covered every required field. Review the form below and
        generate when you&apos;re ready.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {extraction.blocking.length > 0 && (
        <section className="panel review-panel">
          <h2 className="flex items-center gap-2">
            <CircleAlert size={18} aria-hidden style={{ color: "var(--color-error-text)" }} /> We need a few details
          </h2>
          <p className="m-0 mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
            Your documents don&apos;t clearly cover these required fields. Answer them here (or pick a suggestion) to
            continue.
          </p>
          <div className="flex flex-col gap-3">
            {extraction.blocking.map((field) => {
              const resolved = isResolved(field);
              const review = reviews.get(field);
              const hadValue = review?.status !== "missing";
              return (
                <div key={field} className={`review-item${resolved ? " is-resolved" : ""}`}>
                  <p className="m-0 font-semibold">
                    {resolved && <CheckCircle2 size={15} aria-hidden className="mr-1.5 inline align-[-2px]" />}
                    {questionsByField.get(field)?.question ?? review?.reason}
                  </p>
                  <Suggestions question={questionsByField.get(field)} field={field} form={form} disabled={disabled} />
                  <FieldRow
                    name={`${field}-answer`}
                    def={FIELD_DEFS[field]}
                    value={form.draft[field]}
                    isAuto={false}
                    isExcluded={false}
                    disabled={disabled}
                    hideToggles
                    onValueChange={(value) => form.setValue(field, value)}
                  />
                  {hadValue && !resolved && (
                    <button type="button" className="btn btn-secondary btn-small self-start" disabled={disabled} onClick={() => onAcknowledge(field)}>
                      The current value is fine
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {extraction.confirm.length > 0 && (
        <section className="panel review-panel">
          <h2 className="flex items-center gap-2">
            <TriangleAlert size={18} aria-hidden style={{ color: "var(--color-warn-text)" }} /> Please check these
          </h2>
          <p className="m-0 mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
            These values were filled in, but they were inferred, uncertain, or contradicted between documents. Confirm or
            edit each one.
          </p>
          <div className="flex flex-col gap-3">
            {extraction.confirm.map((field) => {
              const resolved = isResolved(field);
              const review = reviews.get(field);
              const conflict = conflictsByField.get(field);
              return (
                <div key={field} className={`review-item${resolved ? " is-resolved" : ""}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="m-0 font-semibold">
                      {resolved && <CheckCircle2 size={15} aria-hidden className="mr-1.5 inline align-[-2px]" />}
                      {review?.label ?? FIELD_DEFS[field]?.label}
                    </p>
                    <div className="flex gap-2">
                      <button type="button" className="btn btn-ghost btn-small" onClick={() => scrollToField(field)}>
                        Edit in form
                      </button>
                      {!resolved && (
                        <button type="button" className="btn btn-secondary btn-small" disabled={disabled} onClick={() => onAcknowledge(field)}>
                          Looks right
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
                    {questionsByField.get(field)?.question ?? review?.reason}
                  </p>
                  {conflict && conflict.options.length > 0 && <ConflictOptions conflict={conflict} form={form} disabled={disabled} />}
                  <Suggestions question={questionsByField.get(field)} field={field} form={form} disabled={disabled} />
                </div>
              );
            })}
          </div>
        </section>
      )}

      {otherQuestions.length > 0 && (
        <section className="panel review-panel">
          <h2>Optional questions</h2>
          <p className="m-0 mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
            Answering these improves the documents, but the AI can draft them from your documents if you skip them.
          </p>
          <div className="flex flex-col gap-3">
            {otherQuestions.map((q) => (
              <div key={q.field} className="review-item">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="m-0 font-semibold">{q.question}</p>
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => scrollToField(q.field)}>
                    Answer in form
                  </button>
                </div>
                <Suggestions question={q} field={q.field} form={form} disabled={disabled} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
