"use client";

import { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { FORM_SECTIONS, FIELD_DEFS } from "@/lib/formConfig";
import { collectFormData, collectReviewedForm, validateRequiredFields } from "@/lib/formLogic";
import { DEMO_DRAFT } from "@/lib/demoData";
import { sectionAnchorId } from "@/lib/formSections";
import { collectWithTemplate, fieldsWithKeptItems, pendingItems } from "@/lib/templateLogic";
import { Domain, FieldReview, GeneratePayload } from "@/lib/types";
import TemplateBanner, { scrollToTemplateItem } from "@/components/templates/TemplateBanner";
import FieldRow from "./FieldRow";
import SectionNav from "./SectionNav";
import { RequestFormState, useRequestFormState } from "./useRequestFormState";

interface RequestFormProps {
  disabled: boolean;
  onSubmit: (payload: GeneratePayload) => void;
  onValidationError: (message: string) => void;
  onClearError: () => void;
  /** Supply to share the form's state with the rest of the page; otherwise the form keeps its own. */
  state?: RequestFormState;
  /** "review": the form was pre-filled from uploaded documents. Shows each field's review
   * status, and hands any field left empty to the AI instead of refusing to submit (the page
   * enforces the required fields itself, via submitBlockedReason). */
  mode?: "manual" | "review";
  fieldReviews?: Record<string, FieldReview>;
  /** When set, the submit button is disabled and this explains why. */
  submitBlockedReason?: ReactNode;
  /** The domain list for the optional project-domain picker. */
  domains?: Domain[];
  /** Manual mode: opens the template gallery (to pick or change a template). */
  onChangeTemplate?: () => void;
  /** Manual mode: goes to the document upload, keeping the template and typed fields. */
  onFillFromDocuments?: () => void;
}

export default function RequestForm({
  disabled,
  onSubmit,
  onValidationError,
  onClearError,
  state,
  mode = "manual",
  fieldReviews,
  submitBlockedReason,
  domains = [],
  onChangeTemplate,
  onFillFromDocuments,
}: RequestFormProps) {
  const ownState = useRequestFormState();
  const formState = state ?? ownState;
  const { draft, autoFields, excludedFields, template, domain, setValue, toggleAuto, toggleExclude, load } = formState;
  const isReview = mode === "review";

  const pending = pendingItems(template, excludedFields);
  const pendingByField: Record<string, number> = {};
  for (const item of pending) pendingByField[item.field] = (pendingByField[item.field] ?? 0) + 1;
  const templateBlockedReason = pending.length ? (
    <>
      {pending.length} template item{pending.length === 1 ? "" : "s"} still need{pending.length === 1 ? "s" : ""} your review —{" "}
      <button type="button" className="link-button" onClick={() => scrollToTemplateItem(pending[0].key)}>
        go to the next one
      </button>
    </>
  ) : undefined;
  const blockedReason =
    submitBlockedReason && templateBlockedReason ? (
      <>
        {submitBlockedReason}
        <br />
        {templateBlockedReason}
      </>
    ) : (
      submitBlockedReason ?? templateBlockedReason
    );
  const keptTemplateFields = fieldsWithKeptItems(template);
  // On the review page the template's banner shows whenever the user brought a template or domain
  // from New Request; on New Request it always shows (it also holds the optional domain picker).
  const showBanner = !isReview || template !== null || domain !== null;

  // For demos: skips typing out a full submission by hand. Fills every field with a complete,
  // realistic example (no auto-generate/exclude flags needed) so Generate Documents can be clicked
  // immediately after.
  function handleFillDemo() {
    onClearError();
    load(DEMO_DRAFT);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    onClearError();
    const autoSet = new Set(Object.entries(autoFields).filter(([, v]) => v).map(([k]) => k));
    const excludedSet = new Set(Object.entries(excludedFields).filter(([, v]) => v).map(([k]) => k));
    if (pending.length) {
      onValidationError(
        `Please review every suggestion from the ${template?.name} template first: accept, edit or remove each one (${pending.length} left).`
      );
      return;
    }
    if (isReview) {
      const reviewed = collectReviewedForm(draft, autoSet, excludedSet);
      // collectReviewedForm hands every empty field to the AI; a field the template's accepted items
      // already cover isn't empty, so it's only enriched if the user ticked auto-generate on it.
      reviewed.auto_fields = reviewed.auto_fields.filter((f) => !keptTemplateFields.has(f) || autoSet.has(f));
      onSubmit(collectWithTemplate(reviewed, template, domain));
      return;
    }
    const payload = collectWithTemplate(collectFormData(draft, autoSet, excludedSet), template, domain);
    const validationError = validateRequiredFields(payload.form, payload.excluded_sections);
    if (validationError) {
      onValidationError(validationError);
      return;
    }
    onSubmit(payload);
  }

  return (
    <section id="form-section">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        {isReview ? (
          <p className="m-0" style={{ color: "var(--color-text-muted)" }}>
            Everything below was filled in from your documents. Edit anything that&apos;s wrong. Fields marked
            &quot;AI will draft&quot; are completed at generation time, grounded in your documents.
          </p>
        ) : (
          <>
            <p className="m-0" style={{ color: "var(--color-text-muted)" }}>
              Describe your project below. Leave anything blank or tick &quot;Auto-generate&quot; on a field you&apos;d
              rather the AI infer — everything you do fill in is kept exactly as written.
            </p>
            <button type="button" className="btn btn-secondary btn-small whitespace-nowrap" disabled={disabled} onClick={handleFillDemo}>
              <Sparkles size={14} /> Fill Demo Data
            </button>
          </>
        )}
      </div>
      {showBanner && (
        <TemplateBanner
          template={template}
          excluded={excludedFields}
          domain={domain}
          domains={domains}
          disabled={disabled}
          onDomainChange={formState.setDomain}
          onChangeTemplate={onChangeTemplate}
          onRemoveTemplate={() => formState.changeTemplate(null)}
          onFillFromDocuments={onFillFromDocuments}
        />
      )}
      <form onSubmit={handleSubmit} className="form-layout">
        <SectionNav draft={draft} filledByTemplate={keptTemplateFields} pendingByField={pendingByField} />
        <div className="flex flex-col gap-3 min-w-0">
          {FORM_SECTIONS.map((section) => (
            <details className="form-section" open key={section.title} id={sectionAnchorId(section.title)}>
              <summary>{section.title}</summary>
              <div className="form-section-body">
                {section.fields.map((fieldName) => {
                  const items = template?.items.filter((i) => i.field === fieldName) ?? [];
                  const review = fieldReviews?.[fieldName];
                  // "AI will draft" is wrong for a field the template is filling in.
                  const showReview = !(review?.state === "auto" && items.some((i) => i.status !== "rejected"));
                  return (
                    <FieldRow
                      key={fieldName}
                      name={fieldName}
                      def={FIELD_DEFS[fieldName]}
                      value={draft[fieldName]}
                      isAuto={!!autoFields[fieldName]}
                      isExcluded={!!excludedFields[fieldName]}
                      disabled={disabled}
                      review={showReview ? review : undefined}
                      template={
                        template && items.length
                          ? {
                              templateName: template.name,
                              items,
                              onValuesChange: formState.setTemplateItemValues,
                              onStatusChange: formState.setTemplateItemStatus,
                              onAcceptAll: () => formState.acceptAllTemplateItems(fieldName),
                            }
                          : undefined
                      }
                      onValueChange={(value) => setValue(fieldName, value)}
                      onToggleAuto={(checked) => toggleAuto(fieldName, checked)}
                      onToggleExclude={(checked) => toggleExclude(fieldName, checked)}
                    />
                  );
                })}
              </div>
            </details>
          ))}
          <div className="mt-2 flex flex-col items-center gap-2">
            <button type="submit" className="btn btn-primary btn-large" disabled={disabled || !!blockedReason}>
              Generate Documents
            </button>
            {blockedReason && (
              <p className="m-0 text-sm" style={{ color: "var(--color-warn-text)" }}>
                {blockedReason}
              </p>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}
