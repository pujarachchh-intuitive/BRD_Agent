"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, FileText } from "lucide-react";
import TopBar from "@/components/layout/TopBar";
import ErrorBanner from "@/components/ErrorBanner";
import RequestForm from "@/components/form/RequestForm";
import { useRequestFormState } from "@/components/form/useRequestFormState";
import ReviewChecklist from "@/components/review/ReviewChecklist";
import DocumentDropzone from "@/components/upload/DocumentDropzone";
import JobProgress, { startingJob } from "@/components/upload/JobProgress";
import { apiExtractDocuments, apiGenerateFromExtraction, apiGetExtraction, apiListDomains, waitForJob } from "@/lib/api";
import { FIELD_DEFS } from "@/lib/formConfig";
import { formToDraft, isDraftFieldAnswered } from "@/lib/formLogic";
import { addRunToHistory } from "@/lib/runHistory";
import { fieldsWithKeptItems, readStartingPoint } from "@/lib/templateLogic";
import { Domain, ExtractionResult, GeneratePayload, Job } from "@/lib/types";

export default function ReviewExtractionPage({ params }: { params: Promise<{ extractionId: string }> }) {
  const { extractionId } = use(params);
  const router = useRouter();
  const form = useRequestFormState();
  const { load, restoreTemplate } = form;
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState<Set<string>>(() => new Set());
  const [job, setJob] = useState<Job | null>(null);
  const [showAddDocuments, setShowAddDocuments] = useState(false);
  const [extraFiles, setExtraFiles] = useState<File[]>([]);
  const errorRef = useRef<HTMLDivElement>(null);
  const isBusy = job !== null;

  useEffect(() => {
    let cancelled = false;
    apiGetExtraction(extractionId)
      .then((data) => {
        if (cancelled) return;
        setExtraction(data);
        // A template, domain or fields the user set up on New Request before uploading. Fields they
        // typed themselves win over the documents' values, as with "Add another document" below.
        const start = readStartingPoint(extractionId);
        const draft = formToDraft(data.form);
        const typedFields = new Set(Object.keys(start?.typed ?? {}));
        for (const field of typedFields) draft[field] = start!.typed[field];
        load(draft, data.auto_fields.filter((f) => !typedFields.has(f)), typedFields);
        if (start) restoreTemplate(start.template, start.domain);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    apiListDomains()
      .then((data) => !cancelled && setDomains(data))
      .catch(() => !cancelled && setDomains([]));
    return () => {
      cancelled = true;
    };
  }, [extractionId, load, restoreTemplate]);

  const fieldReviews = useMemo(
    () => Object.fromEntries((extraction?.fields ?? []).map((f) => [f.field, f])),
    [extraction]
  );

  const keptTemplateFields = fieldsWithKeptItems(form.template);

  /** A blocking field is resolved once it has a real answer that the user either wrote or
   * explicitly accepted; a field to check, once the user edited or confirmed it. */
  function isResolved(field: string): boolean {
    const review = fieldReviews[field];
    const userActed = form.touched.has(field) || acknowledged.has(field);
    if (review?.state === "blocking") {
      // Accepting a template item (e.g. a stakeholder) answers the field just as typing one does.
      const answered = isDraftFieldAnswered(FIELD_DEFS[field], form.draft[field]) || keptTemplateFields.has(field);
      return answered && (review.status === "missing" || userActed);
    }
    return userActed;
  }

  const unresolvedBlocking = extraction?.blocking.filter((f) => !isResolved(f)).length ?? 0;
  const unresolvedConfirm = extraction?.confirm.filter((f) => !isResolved(f)).length ?? 0;
  const pending = [
    unresolvedBlocking ? `${unresolvedBlocking} required question${unresolvedBlocking > 1 ? "s" : ""} to answer` : "",
    unresolvedConfirm ? `${unresolvedConfirm} value${unresolvedConfirm > 1 ? "s" : ""} to check` : "",
  ].filter(Boolean);
  const submitBlockedReason = pending.length ? `Before generating: ${pending.join(" and ")}, at the top of the page.` : undefined;

  function showError(message: string | null) {
    setErrorMessage(message);
    if (message) errorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleAcknowledge(field: string) {
    setAcknowledged((prev) => new Set(prev).add(field));
  }

  async function handleGenerate(collected: GeneratePayload) {
    if (!extraction) return;
    showError(null);
    setJob(startingJob("Starting generation"));
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      const started = await apiGenerateFromExtraction(extraction.extraction_id, collected);
      const result = await waitForJob(started, setJob);
      addRunToHistory({ run_id: result.run_id, project_name: result.project_name, parent_run_id: null });
      router.push(`/runs/${result.run_id}`);
    } catch (err) {
      setJob(null);
      showError(err instanceof Error ? err.message : String(err));
    }
  }

  /** Re-extracts from the earlier files plus the new ones. Anything the user already edited
   * keeps the user's version; everything else takes the new extraction's values. */
  async function handleAddDocuments() {
    if (!extraction) return;
    showError(null);
    setJob(startingJob("Uploading your documents"));
    try {
      const started = await apiExtractDocuments(extraFiles, { extractionId: extraction.extraction_id });
      const result = await waitForJob(started, setJob);
      const nextDraft = formToDraft(result.form);
      for (const field of form.touched) nextDraft[field] = form.draft[field];
      const nextAuto = [
        ...result.auto_fields.filter((f) => !form.touched.has(f)),
        ...[...form.touched].filter((f) => form.autoFields[f]),
      ];
      load(nextDraft, nextAuto, form.touched);
      setExtraction(result);
      setAcknowledged(new Set());
      setExtraFiles([]);
      setShowAddDocuments(false);
      setJob(null);
      window.history.replaceState(null, "", `/new/review/${encodeURIComponent(result.extraction_id)}`);
    } catch (err) {
      setJob(null);
      showError(err instanceof Error ? err.message : String(err));
    }
  }

  const counts = extraction
    ? {
        found: extraction.fields.filter((f) => f.state === "found").length,
        auto: extraction.fields.filter((f) => f.state === "auto").length,
      }
    : null;

  return (
    <>
      <TopBar title={extraction ? `Review: ${extraction.project_name}` : loadError ? "Extraction not found" : "Loading…"} />
      <div className="app-content flex flex-col gap-5">
        <ErrorBanner ref={errorRef} message={errorMessage ?? loadError} />

        {!extraction && !loadError && (
          <div className="flex flex-col gap-4">
            <div className="skeleton" style={{ height: 120 }} />
            <div className="skeleton" style={{ height: 320 }} />
          </div>
        )}

        {extraction && counts && (
          <>
            <section className="panel flex flex-col gap-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="m-0">What we found in your documents</h2>
                  {extraction.summary && (
                    <p className="m-0 mt-1" style={{ color: "var(--color-text-muted)" }}>
                      {extraction.summary}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={isBusy || extraction.files.length >= 5}
                  onClick={() => setShowAddDocuments((v) => !v)}
                >
                  <FilePlus2 size={14} /> Add another document
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {extraction.files.map((file) => (
                  <span key={file.file_name} className="chip chip-neutral">
                    <FileText size={13} aria-hidden /> {file.file_name}
                    {file.page_count ? ` · ${file.page_count} p.` : ""}
                    {file.scanned ? " · scanned" : ""}
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="chip chip-success">{counts.found} fields found with sources</span>
                {extraction.blocking.length > 0 && (
                  <span className="chip chip-error">{extraction.blocking.length} need your input</span>
                )}
                {extraction.confirm.length > 0 && <span className="chip chip-warn">{extraction.confirm.length} to check</span>}
                {counts.auto > 0 && <span className="chip">{counts.auto} the AI will draft</span>}
              </div>

              {showAddDocuments && !isBusy && (
                <div className="flex flex-col gap-3 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
                  <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
                    The AI reads the new documents together with the ones you already uploaded. Anything you&apos;ve already
                    edited below is kept.
                  </p>
                  <DocumentDropzone files={extraFiles} onChange={setExtraFiles} existingCount={extraction.files.length} />
                  <div className="flex justify-end">
                    <button type="button" className="btn btn-primary btn-small" disabled={!extraFiles.length} onClick={handleAddDocuments}>
                      Read the new documents
                    </button>
                  </div>
                </div>
              )}
            </section>

            {job && <JobProgress job={job} />}

            <ReviewChecklist
              extraction={extraction}
              form={form}
              isResolved={isResolved}
              onAcknowledge={handleAcknowledge}
              disabled={isBusy}
            />

            <RequestForm
              mode="review"
              state={form}
              domains={domains}
              fieldReviews={fieldReviews}
              disabled={isBusy}
              submitBlockedReason={submitBlockedReason}
              onSubmit={handleGenerate}
              onValidationError={showError}
              onClearError={() => showError(null)}
            />
          </>
        )}
      </div>
    </>
  );
}
