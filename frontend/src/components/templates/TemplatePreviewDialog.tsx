"use client";

import { useState } from "react";
import { ArrowRight, FileUp, Info } from "lucide-react";
import Modal from "@/components/Modal";
import { TEMPLATE_DISCLAIMER, defaultAnswers, offeredItems } from "@/lib/templateLogic";
import { PublishedTemplate } from "@/lib/types";
import TemplateContentView from "./TemplateContentView";
import TemplateThumb from "./TemplateThumb";

interface TemplatePreviewDialogProps {
  template: PublishedTemplate | null;
  /** Shown when applying this template would replace one already in use. */
  replacingName?: string | null;
  onClose: () => void;
  onUse: (template: PublishedTemplate, answers: Record<string, boolean>) => void;
  /** Applies the template, then goes to the document upload so the documents fill in the rest. */
  onUseWithDocuments?: (template: PublishedTemplate, answers: Record<string, boolean>) => void;
}

export default function TemplatePreviewDialog(props: TemplatePreviewDialogProps) {
  // Keyed on the template so the applicability answers reset whenever a different one opens.
  return <PreviewBody key={props.template?.template_id ?? "none"} {...props} />;
}

function PreviewBody({ template, replacingName, onClose, onUse, onUseWithDocuments }: TemplatePreviewDialogProps) {
  const [answers, setAnswers] = useState<Record<string, boolean>>(() => (template ? defaultAnswers(template) : {}));
  const count = template ? offeredItems(template, answers).length : 0;

  return (
    <Modal
      open={template !== null}
      size="lg"
      onClose={onClose}
      title={
        template && (
          <div className="flex items-center gap-3">
            <TemplateThumb icon={template.icon} color={template.color} size="sm" />
            <div className="min-w-0">
              <div className="modal-title-text">{template.name}</div>
              <div className="modal-subtitle">
                {template.domain_name} · version {template.version}
                {template.published_at ? ` · updated ${formatDate(template.published_at)}` : ""}
              </div>
            </div>
          </div>
        )
      }
      footer={
        template && (
          <>
            <span className="mr-auto text-sm" style={{ color: "var(--color-text-muted)" }}>
              {count} item{count === 1 ? "" : "s"} will be added for you to review
            </span>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            {onUseWithDocuments && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!count}
                title="Apply the template, then upload documents to fill in the rest of the form"
                onClick={() => onUseWithDocuments(template, answers)}
              >
                <FileUp size={16} /> Use with documents
              </button>
            )}
            <button type="button" className="btn btn-primary" disabled={!count} onClick={() => onUse(template, answers)}>
              Use this template <ArrowRight size={16} />
            </button>
          </>
        )
      }
    >
      {template && (
        <div className="template-preview">
          <div className="template-preview-side">
            {template.description && <p className="m-0">{template.description}</p>}

            {template.content.questions.length > 0 && (
              <fieldset className="template-questions">
                <legend>Does this apply to your project?</legend>
                {template.content.questions.map((q) => (
                  <label key={q.key} className="template-question">
                    <input
                      type="checkbox"
                      checked={!!answers[q.key]}
                      onChange={(e) => setAnswers((prev) => ({ ...prev, [q.key]: e.target.checked }))}
                    />
                    <span>{q.text}</span>
                  </label>
                ))}
                <p className="template-questions-hint">Items that depend on a question are only added when it&apos;s ticked.</p>
              </fieldset>
            )}

            <div className="template-disclaimer">
              <Info size={15} className="mt-0.5 flex-shrink-0" />
              <span>
                {TEMPLATE_DISCLAIMER} Every item is added as a suggestion: you accept, edit or remove each one before generating.
              </span>
            </div>

            {replacingName && (
              <div className="template-disclaimer is-warn">
                <Info size={15} className="mt-0.5 flex-shrink-0" />
                <span>
                  This replaces <strong>{replacingName}</strong>. Items you already accepted or edited from it stay in the form as
                  your own entries; ones still waiting for review are dropped.
                </span>
              </div>
            )}
          </div>
          <div className="template-preview-main">
            <TemplateContentView content={template.content} answers={answers} />
          </div>
        </div>
      )}
    </Modal>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
