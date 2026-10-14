"use client";

import { Plus, Trash2 } from "lucide-react";
import { FIELD_DEFS, FORM_SECTIONS } from "@/lib/formConfig";
import { TAG_LABELS } from "@/lib/templateLogic";
import { TemplateContent, TemplateItem, TemplateQuestion, TemplateTag } from "@/lib/types";

const FIELD_ORDER = FORM_SECTIONS.flatMap((s) => s.fields);
const KEY_PREFIXES: Record<string, string> = {
  stakeholders: "stk",
  functional_requirements: "fr",
  non_functional_requirements: "nfr",
  risks: "risk",
  constraints: "con",
  dependencies: "dep",
  integrations: "int",
  open_questions: "oq",
};
export const MAX_GUIDANCE_LENGTH = 4000;

function randomSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return [...bytes].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 6);
}

interface TemplateContentEditorProps {
  content: TemplateContent;
  /** Field name -> the value names its items need (GET /api/admin/templates/schema). */
  fields: Record<string, string[]>;
  disabled: boolean;
  onChange: (content: TemplateContent) => void;
}

/** Edits a template draft: AI guidance, applicability questions, and the items for each field.
 * Item and question keys are generated once and never edited, so an item can be followed across
 * versions. */
export default function TemplateContentEditor({ content, fields, disabled, onChange }: TemplateContentEditorProps) {
  const fieldNames = FIELD_ORDER.filter((f) => f in fields);

  function setQuestions(questions: TemplateQuestion[]) {
    onChange({ ...content, questions });
  }

  function removeQuestion(key: string) {
    const used = Object.values(content.items).flat().filter((i) => i.applies_if === key).length;
    if (used && !window.confirm(`${used} item${used === 1 ? " depends" : "s depend"} on this question. Remove it and make ${used === 1 ? "that item" : "those items"} always apply?`)) {
      return;
    }
    const items = Object.fromEntries(
      Object.entries(content.items).map(([f, list]) => [f, list.map((i) => (i.applies_if === key ? { ...i, applies_if: null } : i))])
    );
    onChange({ ...content, questions: content.questions.filter((q) => q.key !== key), items });
  }

  function setItems(field: string, items: TemplateItem[]) {
    onChange({ ...content, items: { ...content.items, [field]: items } });
  }

  function addItem(field: string) {
    const def = FIELD_DEFS[field];
    const values = Object.fromEntries(
      fields[field].map((name) => {
        const sf = def.kind === "list_obj" ? def.subfields.find((s) => s.name === name) : undefined;
        return [name, sf?.type === "select" ? (sf.default ?? sf.options?.[0] ?? "") : ""];
      })
    );
    const item: TemplateItem = {
      key: `${KEY_PREFIXES[field] ?? "item"}-${randomSuffix()}`,
      values,
      tag: "best_practice",
      source: "",
      source_url: null,
      applies_if: null,
    };
    setItems(field, [...(content.items[field] ?? []), item]);
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="panel flex flex-col gap-2">
        <h2 className="m-0">Guidance for the AI</h2>
        <p className="studio-hint">
          Used only when the user asks the AI to auto-generate a section. Describe what matters in this domain and when each
          regulation applies. Don&apos;t include anything you&apos;re not sure about.
        </p>
        <textarea
          className="field-input"
          rows={7}
          maxLength={MAX_GUIDANCE_LENGTH}
          value={content.domain_guidance}
          disabled={disabled}
          aria-label="Guidance for the AI"
          onChange={(e) => onChange({ ...content, domain_guidance: e.target.value })}
        />
        <span className="studio-hint text-right">
          {content.domain_guidance.length} / {MAX_GUIDANCE_LENGTH}
        </span>
      </section>

      <section className="panel flex flex-col gap-3">
        <div>
          <h2 className="m-0">Applicability questions</h2>
          <p className="studio-hint">
            Shown to users before they apply the template. Items linked to a question are only added when it&apos;s ticked —
            e.g. card-payment rules only when the system handles card data.
          </p>
        </div>
        {content.questions.map((q, index) => (
          <div key={q.key} className="studio-row">
            <input
              className="field-input flex-1"
              maxLength={200}
              value={q.text}
              placeholder="e.g. Does the system store, process or transmit payment card data?"
              disabled={disabled}
              aria-label={`Question ${index + 1}`}
              onChange={(e) => setQuestions(content.questions.map((x) => (x.key === q.key ? { ...x, text: e.target.value } : x)))}
            />
            <label className="auto-toggle" title="Whether the box starts ticked">
              <input
                type="checkbox"
                checked={q.default}
                disabled={disabled}
                onChange={(e) => setQuestions(content.questions.map((x) => (x.key === q.key ? { ...x, default: e.target.checked } : x)))}
              />
              Ticked by default
            </label>
            <button type="button" className="btn-icon" aria-label="Remove question" disabled={disabled} onClick={() => removeQuestion(q.key)}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        <div>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            disabled={disabled || content.questions.length >= 10}
            onClick={() => setQuestions([...content.questions, { key: `q_${randomSuffix()}`, text: "", default: false }])}
          >
            <Plus size={14} /> Add question
          </button>
        </div>
      </section>

      {fieldNames.map((field) => {
        const def = FIELD_DEFS[field];
        const items = content.items[field] ?? [];
        return (
          <details key={field} className="form-section" open={items.length > 0}>
            <summary>
              {def.label}
              <span className="template-view-count ml-2">{items.length}</span>
            </summary>
            <div className="form-section-body">
              {items.map((item) => (
                <ItemEditor
                  key={item.key}
                  field={field}
                  item={item}
                  valueNames={fields[field]}
                  questions={content.questions}
                  disabled={disabled}
                  onChange={(next) => setItems(field, items.map((i) => (i.key === item.key ? next : i)))}
                  onRemove={() => setItems(field, items.filter((i) => i.key !== item.key))}
                />
              ))}
              <div>
                <button type="button" className="btn btn-secondary btn-small" disabled={disabled} onClick={() => addItem(field)}>
                  <Plus size={14} /> Add {def.label.toLowerCase()} item
                </button>
              </div>
            </div>
          </details>
        );
      })}
    </div>
  );
}

interface ItemEditorProps {
  field: string;
  item: TemplateItem;
  valueNames: string[];
  questions: TemplateQuestion[];
  disabled: boolean;
  onChange: (item: TemplateItem) => void;
  onRemove: () => void;
}

function ItemEditor({ field, item, valueNames, questions, disabled, onChange, onRemove }: ItemEditorProps) {
  const def = FIELD_DEFS[field];
  const id = (name: string) => `item-${item.key}-${name}`;

  return (
    <div className="studio-item">
      <div className="studio-item-values">
        {valueNames.map((name) => {
          const sf = def.kind === "list_obj" ? def.subfields.find((s) => s.name === name) : undefined;
          const label = sf?.label ?? def.label;
          return (
            <div key={name} className="repeater-cell">
              <label htmlFor={id(name)}>{label}</label>
              {sf?.type === "select" ? (
                <select
                  id={id(name)}
                  className="field-input cursor-pointer"
                  value={item.values[name] ?? ""}
                  disabled={disabled}
                  onChange={(e) => onChange({ ...item, values: { ...item.values, [name]: e.target.value } })}
                >
                  {(sf.options ?? []).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <textarea
                  id={id(name)}
                  className="field-input template-item-input"
                  rows={1}
                  maxLength={600}
                  value={item.values[name] ?? ""}
                  disabled={disabled}
                  onChange={(e) => onChange({ ...item, values: { ...item.values, [name]: e.target.value } })}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="studio-item-meta">
        <div className="repeater-cell">
          <label htmlFor={id("tag")}>Type</label>
          <select
            id={id("tag")}
            className="field-input cursor-pointer"
            value={item.tag}
            disabled={disabled}
            onChange={(e) => onChange({ ...item, tag: e.target.value as TemplateTag })}
          >
            {(Object.keys(TAG_LABELS) as TemplateTag[]).map((tag) => (
              <option key={tag} value={tag}>
                {TAG_LABELS[tag]}
              </option>
            ))}
          </select>
        </div>
        <div className="repeater-cell studio-item-source">
          <label htmlFor={id("source")}>Source</label>
          <input
            id={id("source")}
            className="field-input"
            maxLength={300}
            placeholder="e.g. HIPAA Security Rule, 45 CFR 164.312(b)"
            value={item.source}
            disabled={disabled}
            onChange={(e) => onChange({ ...item, source: e.target.value })}
          />
        </div>
        <div className="repeater-cell studio-item-source">
          <label htmlFor={id("url")}>Source link</label>
          <input
            id={id("url")}
            className="field-input"
            maxLength={500}
            placeholder="https://"
            value={item.source_url ?? ""}
            disabled={disabled}
            onChange={(e) => onChange({ ...item, source_url: e.target.value || null })}
          />
        </div>
        <div className="repeater-cell">
          <label htmlFor={id("applies")}>Applies</label>
          <select
            id={id("applies")}
            className="field-input cursor-pointer"
            value={item.applies_if ?? ""}
            disabled={disabled}
            onChange={(e) => onChange({ ...item, applies_if: e.target.value || null })}
          >
            <option value="">Always</option>
            {questions.map((q) => (
              <option key={q.key} value={q.key}>
                If: {q.text.length > 48 ? `${q.text.slice(0, 48)}…` : q.text || q.key}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn-icon self-end" aria-label="Remove item" title="Remove item from this draft" disabled={disabled} onClick={onRemove}>
          <Trash2 size={15} />
        </button>
      </div>
      <span className="studio-item-key">Key: {item.key}</span>
    </div>
  );
}
