"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Plus, Search } from "lucide-react";
import { countsByLabel, readRecentTemplates } from "@/lib/templateLogic";
import { PublishedTemplate } from "@/lib/types";
import TemplateThumb from "./TemplateThumb";

interface TemplateGalleryProps {
  templates: PublishedTemplate[] | null;
  /** The template the form currently uses, if any. */
  activeTemplateId: string | null;
  disabled: boolean;
  onBlank: () => void;
  onPick: (template: PublishedTemplate) => void;
}

function totalItems(template: PublishedTemplate): number {
  return Object.values(template.counts).reduce((sum, n) => sum + n, 0);
}

function TemplateCard({ template, active, disabled, onPick }: { template: PublishedTemplate; active: boolean; disabled: boolean; onPick: () => void }) {
  const counts = countsByLabel(template.counts);
  return (
    <button type="button" className={`template-card${active ? " is-active" : ""}`} disabled={disabled} onClick={onPick}>
      <TemplateThumb icon={template.icon} color={template.color} />
      <span className="template-card-body">
        <span className="template-card-name">
          {template.name}
          {active && (
            <span className="chip chip-success ml-2 align-middle">
              <Check size={12} /> In use
            </span>
          )}
        </span>
        <span className="template-card-domain">{template.domain_name}</span>
        {template.description && <span className="template-card-desc">{template.description}</span>}
        <span className="template-card-meta" title={counts.map((c) => `${c.label}: ${c.count}`).join("\n")}>
          {totalItems(template)} suggested items · {counts.length} section{counts.length === 1 ? "" : "s"}
        </span>
      </span>
    </button>
  );
}

/** "Start from template": a Word-style gallery — Blank first, then every published template,
 * searchable and filterable by domain. */
export default function TemplateGallery({ templates, activeTemplateId, disabled, onBlank, onPick }: TemplateGalleryProps) {
  const [query, setQuery] = useState("");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [recentIds, setRecentIds] = useState<string[]>([]);

  useEffect(() => {
    // localStorage only exists in the browser, so this can't be a lazy useState initializer.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecentIds(readRecentTemplates());
  }, []);

  const domainChips = useMemo(() => {
    const seen = new Map<string, string>();
    for (const t of templates ?? []) seen.set(t.domain_id, t.domain_name);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [templates]);

  const q = query.trim().toLowerCase();
  const visible = (templates ?? []).filter(
    (t) =>
      (domainFilter === "all" || t.domain_id === domainFilter) &&
      (!q || `${t.name} ${t.domain_name} ${t.description}`.toLowerCase().includes(q))
  );
  const recent = recentIds
    .map((id) => templates?.find((t) => t.template_id === id))
    .filter((t): t is PublishedTemplate => !!t);

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 max-w-2xl" style={{ color: "var(--color-text-muted)" }}>
          Start from a blank form, or from a template that pre-fills the requirements most projects in a domain share. You
          review every suggested item before anything is generated.
        </p>
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" style={{ color: "var(--color-text-muted)" }} />
          <input
            type="search"
            className="field-input py-1.5 pl-8 text-sm"
            style={{ width: 240 }}
            placeholder="Search templates..."
            aria-label="Search templates"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {domainChips.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by domain">
          {[{ id: "all", name: "All" }, ...domainChips].map((chip) => (
            <button
              key={chip.id}
              type="button"
              className={`filter-chip${domainFilter === chip.id ? " active" : ""}`}
              aria-pressed={domainFilter === chip.id}
              onClick={() => setDomainFilter(chip.id)}
            >
              {chip.name}
            </button>
          ))}
        </div>
      )}

      <div className="template-grid">
        <button type="button" className="template-card template-card-blank" disabled={disabled} onClick={onBlank}>
          <span className="template-thumb template-thumb-md template-thumb-blank" aria-hidden>
            <Plus size={26} />
          </span>
          <span className="template-card-body">
            <span className="template-card-name">Blank</span>
            <span className="template-card-domain">Any domain</span>
            <span className="template-card-desc">An empty form. Optionally tell us the project&apos;s domain.</span>
          </span>
        </button>

        {templates === null
          ? [0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 248 }} />)
          : visible.map((t) => (
              <TemplateCard
                key={t.template_id}
                template={t}
                active={t.template_id === activeTemplateId}
                disabled={disabled}
                onPick={() => onPick(t)}
              />
            ))}
      </div>

      {templates !== null && templates.length === 0 && (
        <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
          No templates have been published yet. An admin can create them in Template Studio.
        </p>
      )}
      {templates !== null && templates.length > 0 && visible.length === 0 && (
        <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
          No templates match your search.
        </p>
      )}

      {recent.length > 0 && !q && domainFilter === "all" && (
        <div className="flex flex-wrap items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
          <span>Recently used:</span>
          {recent.map((t) => (
            <button key={t.template_id} type="button" className="filter-chip" disabled={disabled} onClick={() => onPick(t)}>
              {t.name}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
