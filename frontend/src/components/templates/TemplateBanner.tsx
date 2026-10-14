"use client";

import { ArrowDown, FileUp, Info, LayoutTemplate, X } from "lucide-react";
import { AppliedTemplate, DomainSelection, TEMPLATE_DISCLAIMER, keptItemCount, pendingItems, reviewProgress } from "@/lib/templateLogic";
import { Domain } from "@/lib/types";
import DomainPicker from "./DomainPicker";
import TemplateThumb from "./TemplateThumb";

interface TemplateBannerProps {
  template: AppliedTemplate | null;
  excluded: Record<string, boolean>;
  domain: DomainSelection;
  domains: Domain[];
  disabled: boolean;
  onDomainChange: (domain: DomainSelection) => void;
  /** Opens the template gallery. Left out where switching templates isn't offered (review page). */
  onChangeTemplate?: () => void;
  onRemoveTemplate: () => void;
  /** Goes to the document upload, keeping the template and anything already typed. */
  onFillFromDocuments?: () => void;
}

export function scrollToTemplateItem(key: string) {
  const el = document.getElementById(`template-item-${key}`);
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
  el?.querySelector<HTMLElement>("textarea, input, select")?.focus({ preventScroll: true });
}

/** Top of the form: which template is in use and how much of it is reviewed — or, on a blank
 * start, the optional project domain. */
export default function TemplateBanner({
  template,
  excluded,
  domain,
  domains,
  disabled,
  onDomainChange,
  onChangeTemplate,
  onRemoveTemplate,
  onFillFromDocuments,
}: TemplateBannerProps) {
  if (!template) {
    return (
      <div className="domain-row">
        <label htmlFor="form-domain" className="domain-row-label">
          Project domain <span>(optional)</span>
        </label>
        <div className="domain-row-picker">
          <DomainPicker id="form-domain" domains={domains} value={domain} onChange={onDomainChange} disabled={disabled} />
        </div>
        {onChangeTemplate && (
          <button type="button" className="btn btn-ghost btn-small" disabled={disabled} onClick={onChangeTemplate}>
            <LayoutTemplate size={14} /> Start from a template instead
          </button>
        )}
      </div>
    );
  }

  const { total, reviewed } = reviewProgress(template, excluded);
  const pending = pendingItems(template, excluded);
  const percent = total ? Math.round((reviewed / total) * 100) : 100;

  function handleRemove() {
    const kept = keptItemCount(template);
    const message = kept
      ? `Stop using the ${template!.name} template? The ${kept} item${kept === 1 ? "" : "s"} you accepted or edited stay in the form as your own entries; items still waiting for review are dropped.`
      : `Stop using the ${template!.name} template? Its suggestions that are still waiting for review are dropped.`;
    if (window.confirm(message)) onRemoveTemplate();
  }

  return (
    <div className={`template-banner${pending.length ? "" : " is-done"}`}>
      <div className="template-banner-main">
        <TemplateThumb icon={template.icon} color={template.color} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="template-banner-title">
            {template.name} <span className="template-banner-version">v{template.version}</span>
          </div>
          <div className="template-banner-meta">Domain: {template.domain_name}</div>
          <div className="template-progress" aria-label={`${reviewed} of ${total} template items reviewed`}>
            <div className="template-progress-track">
              <div className="template-progress-fill" style={{ width: `${percent}%` }} />
            </div>
            <span>
              {reviewed} of {total} reviewed
            </span>
          </div>
        </div>
        <div className="template-banner-actions">
          {pending.length > 0 && (
            <button type="button" className="btn btn-primary btn-small" onClick={() => scrollToTemplateItem(pending[0].key)}>
              <ArrowDown size={14} /> Review next
            </button>
          )}
          {onFillFromDocuments && (
            <button
              type="button"
              className="btn btn-secondary btn-small"
              disabled={disabled}
              title="Upload documents to fill in the other fields — the template's items and anything you've typed are kept"
              onClick={onFillFromDocuments}
            >
              <FileUp size={14} /> Fill the rest from documents
            </button>
          )}
          {onChangeTemplate && (
            <button type="button" className="btn btn-secondary btn-small" disabled={disabled} onClick={onChangeTemplate}>
              Change template
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-small" disabled={disabled} onClick={handleRemove} title="Stop using this template">
            <X size={14} /> Remove
          </button>
        </div>
      </div>
      <p className="template-banner-note">
        <Info size={13} className="mt-0.5 flex-shrink-0" />
        <span>{TEMPLATE_DISCLAIMER}</span>
      </p>
    </div>
  );
}
