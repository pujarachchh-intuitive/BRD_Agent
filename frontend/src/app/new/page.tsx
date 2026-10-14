"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, LayoutTemplate, PencilLine } from "lucide-react";
import TopBar from "@/components/layout/TopBar";
import ErrorBanner from "@/components/ErrorBanner";
import LoadingSection from "@/components/LoadingSection";
import RequestForm from "@/components/form/RequestForm";
import { useRequestFormState } from "@/components/form/useRequestFormState";
import BlankStartDialog from "@/components/templates/BlankStartDialog";
import TemplateGallery from "@/components/templates/TemplateGallery";
import TemplatePreviewDialog from "@/components/templates/TemplatePreviewDialog";
import TemplateThumb from "@/components/templates/TemplateThumb";
import UploadPanel from "@/components/upload/UploadPanel";
import { apiGenerate, apiListDomains, apiListTemplates } from "@/lib/api";
import { DraftFormState, isDraftValueFilled } from "@/lib/formLogic";
import { addRunToHistory } from "@/lib/runHistory";
import { DomainSelection, StartingPoint, applyTemplate, rememberTemplate } from "@/lib/templateLogic";
import { Domain, GeneratePayload, PublishedTemplate } from "@/lib/types";

type Tab = "templates" | "form" | "upload";

export default function NewRequestPage() {
  const router = useRouter();
  const form = useRequestFormState();
  const [tab, setTab] = useState<Tab>("templates");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [templates, setTemplates] = useState<PublishedTemplate[] | null>(null);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [templatesUnavailable, setTemplatesUnavailable] = useState(false);
  const [previewing, setPreviewing] = useState<PublishedTemplate | null>(null);
  const [blankOpen, setBlankOpen] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    // Templates are an optional starting point: if they can't be loaded, Blank and the other tabs
    // still work, so this never blocks the page.
    apiListTemplates()
      .then((data) => !cancelled && setTemplates(data))
      .catch(() => {
        if (cancelled) return;
        setTemplates([]);
        setTemplatesUnavailable(true);
      });
    apiListDomains()
      .then((data) => !cancelled && setDomains(data))
      .catch(() => !cancelled && setDomains([]));
    return () => {
      cancelled = true;
    };
  }, []);

  function showError(message: string | null) {
    setErrorMessage(message);
    if (message) errorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleGenerate(payload: GeneratePayload) {
    setIsLoading(true);
    try {
      const data = await apiGenerate(payload);
      addRunToHistory({ run_id: data.run_id, project_name: data.requirements_json.project_name, parent_run_id: null });
      router.push(`/runs/${data.run_id}`);
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
      setIsLoading(false);
    }
  }

  function switchTab(next: Tab) {
    setErrorMessage(null);
    setTab(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleStartBlank(domain: DomainSelection) {
    if (form.template) {
      const ok = window.confirm(
        `Start blank instead of the ${form.template.name} template? Items you accepted or edited stay in the form as your own entries; suggestions still waiting for review are dropped.`
      );
      if (!ok) return;
      form.changeTemplate(null);
    }
    form.setDomain(domain);
    setBlankOpen(false);
    switchTab("form");
  }

  function handleUseTemplate(template: PublishedTemplate, answers: Record<string, boolean>, next: Tab = "form") {
    form.changeTemplate(applyTemplate(template, answers));
    rememberTemplate(template.template_id);
    setPreviewing(null);
    switchTab(next);
  }

  /** Carried into the review page after an upload, so the documents only fill in what's missing. */
  function startingPoint(): StartingPoint | null {
    const typed: DraftFormState = {};
    for (const field of form.touched) {
      if (isDraftValueFilled(form.draft[field])) typed[field] = form.draft[field];
    }
    if (!form.template && !form.domain && !Object.keys(typed).length) return null;
    return { template: form.template, domain: form.domain, typed };
  }

  const typedFieldCount = [...form.touched].filter((f) => isDraftValueFilled(form.draft[f])).length;

  const tabs: { id: Tab; label: string; icon: typeof PencilLine }[] = [
    { id: "templates", label: "Start from template", icon: LayoutTemplate },
    { id: "form", label: "Fill in the form", icon: PencilLine },
    { id: "upload", label: "Upload documents", icon: FileUp },
  ];

  return (
    <>
      <TopBar title="New Request" />
      <div className="app-content">
        <div className="tabs mb-5" role="tablist">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`tab-btn${tab === id ? " active" : ""}`}
              disabled={isLoading}
              onClick={() => switchTab(id)}
            >
              <Icon size={15} className="mr-1.5 inline align-[-2px]" /> {label}
              {id === "form" && form.template && <span className="tab-badge">{form.template.name}</span>}
            </button>
          ))}
        </div>

        <ErrorBanner ref={errorRef} message={errorMessage} />

        {tab === "templates" && (
          <>
            {templatesUnavailable && (
              <p className="mb-4 text-sm" style={{ color: "var(--color-warn-text)" }}>
                Templates couldn&apos;t be loaded right now. You can still start blank or upload documents.
              </p>
            )}
            <TemplateGallery
              templates={templates}
              activeTemplateId={form.template?.template_id ?? null}
              disabled={isLoading}
              onBlank={() => setBlankOpen(true)}
              onPick={setPreviewing}
            />
          </>
        )}

        {tab === "upload" && (
          <div className="flex flex-col gap-4">
            {(form.template || typedFieldCount > 0) && (
              <div className="carry-over-note">
                {form.template ? (
                  <TemplateThumb icon={form.template.icon} color={form.template.color} size="sm" />
                ) : (
                  <PencilLine size={18} className="flex-shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <strong>
                    {form.template ? `Your ${form.template.name} template comes with you.` : "What you've typed comes with you."}
                  </strong>{" "}
                  {form.template ? `Its ${form.template.items.length} suggested items` : ""}
                  {form.template && typedFieldCount ? " and " : ""}
                  {typedFieldCount ? `the ${typedFieldCount} field${typedFieldCount === 1 ? "" : "s"} you filled in` : ""} are kept
                  as they are; the documents fill in everything else. You review it all on the next page.
                </div>
              </div>
            )}
            <UploadPanel onError={showError} startingPoint={startingPoint} />
          </div>
        )}

        {tab === "form" && (
          <>
            <LoadingSection visible={isLoading} message="Generating your documents — this usually takes 30-90 seconds..." />
            <RequestForm
              state={form}
              disabled={isLoading}
              domains={domains}
              onChangeTemplate={() => switchTab("templates")}
              onFillFromDocuments={() => switchTab("upload")}
              onSubmit={handleGenerate}
              onValidationError={showError}
              onClearError={() => setErrorMessage(null)}
            />
          </>
        )}
      </div>

      <TemplatePreviewDialog
        template={previewing}
        replacingName={form.template ? form.template.name : null}
        onClose={() => setPreviewing(null)}
        onUse={handleUseTemplate}
        onUseWithDocuments={(t, answers) => handleUseTemplate(t, answers, "upload")}
      />
      <BlankStartDialog
        open={blankOpen}
        domains={domains}
        templates={templates ?? []}
        initialDomain={form.domain}
        onClose={() => setBlankOpen(false)}
        onStart={handleStartBlank}
        onPreviewTemplate={(t) => {
          setBlankOpen(false);
          setPreviewing(t);
        }}
      />
    </>
  );
}
