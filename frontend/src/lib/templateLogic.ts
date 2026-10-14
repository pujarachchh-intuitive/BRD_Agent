// Pure helpers for a template applied to the request form. The template's items live alongside
// the draft (not inside it) until submit, each with a review status; collectWithTemplate then
// merges the accepted/edited ones into the payload ahead of the user's own entries and reports a
// decision for every item, which the backend re-checks (webapp/doc_templates/service.py).

import { FIELD_DEFS, FORM_SECTIONS } from "./formConfig";
import { CollectedForm, DraftFormState, DraftRepeaterRow, emptyDraftRow } from "./formLogic";
import {
  DomainChoicePayload,
  GeneratePayload,
  PublishedTemplate,
  RepeaterRow,
  TemplateDecision,
  TemplateItem,
  TemplateTag,
} from "./types";

export type TemplateItemStatus = "pending" | TemplateDecision;

export interface AppliedTemplateItem {
  key: string;
  field: string;
  values: Record<string, string>;
  /** The values as the template offered them — editing back to these counts as accepting. */
  original: Record<string, string>;
  tag: TemplateTag;
  source: string;
  source_url: string | null;
  status: TemplateItemStatus;
}

export interface AppliedTemplate {
  template_id: string;
  version: number;
  name: string;
  icon: string;
  color: string;
  domain_id: string;
  domain_name: string;
  answers: Record<string, boolean>;
  items: AppliedTemplateItem[];
}

/** A blank start's optional domain: one from the admin list, or free text typed under Other. */
export type DomainSelection = { domain_id: string; name: string } | { other: string } | null;

export const TEMPLATE_DISCLAIMER =
  "Starting points based on public standards — not legal or compliance advice. Confirm with your compliance team.";

const FIELD_ORDER = FORM_SECTIONS.flatMap((s) => s.fields);

export function defaultAnswers(template: PublishedTemplate): Record<string, boolean> {
  return Object.fromEntries(template.content.questions.map((q) => [q.key, q.default]));
}

/** The items a template offers for the given applicability answers, in form order. */
export function offeredItems(template: PublishedTemplate, answers: Record<string, boolean>): [string, TemplateItem][] {
  const out: [string, TemplateItem][] = [];
  for (const field of FIELD_ORDER) {
    for (const item of template.content.items[field] ?? []) {
      if (item.applies_if === null || answers[item.applies_if]) out.push([field, item]);
    }
  }
  return out;
}

export function applyTemplate(template: PublishedTemplate, answers: Record<string, boolean>): AppliedTemplate {
  return {
    template_id: template.template_id,
    version: template.version,
    name: template.name,
    icon: template.icon,
    color: template.color,
    domain_id: template.domain_id,
    domain_name: template.domain_name,
    answers,
    items: offeredItems(template, answers).map(([field, item]) => ({
      key: item.key,
      field,
      values: { ...item.values },
      original: { ...item.values },
      tag: item.tag,
      source: item.source,
      source_url: item.source_url,
      status: "pending",
    })),
  };
}

function sameValues(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => (a[k] ?? "").trim() === (b[k] ?? "").trim());
}

export function setItemValues(applied: AppliedTemplate, key: string, values: Record<string, string>): AppliedTemplate {
  return {
    ...applied,
    items: applied.items.map((item) =>
      item.key === key ? { ...item, values, status: sameValues(values, item.original) ? "accepted" : "edited" } : item
    ),
  };
}

export function setItemStatus(applied: AppliedTemplate, key: string, status: TemplateItemStatus): AppliedTemplate {
  return {
    ...applied,
    items: applied.items.map((item) => {
      if (item.key !== key) return item;
      // Undoing a removal brings back what the user had (edited stays edited).
      if (status === "pending") return { ...item, status: sameValues(item.values, item.original) ? "pending" : "edited" };
      return { ...item, status };
    }),
  };
}

/** Accepts every still-pending item — of one field, or of the whole template. */
export function acceptAllPending(applied: AppliedTemplate, field?: string): AppliedTemplate {
  return {
    ...applied,
    items: applied.items.map((item) =>
      item.status === "pending" && (!field || item.field === field) ? { ...item, status: "accepted" } : item
    ),
  };
}

/** Items still waiting for a decision. A field marked "Not applicable" needs none. */
export function pendingItems(applied: AppliedTemplate | null, excluded: Record<string, boolean>): AppliedTemplateItem[] {
  return applied ? applied.items.filter((i) => i.status === "pending" && !excluded[i.field]) : [];
}

export function reviewProgress(applied: AppliedTemplate, excluded: Record<string, boolean>) {
  const relevant = applied.items.filter((i) => !excluded[i.field]);
  return { total: relevant.length, reviewed: relevant.filter((i) => i.status !== "pending").length };
}

/** Fields that have at least one accepted/edited template item — they count as filled. */
export function fieldsWithKeptItems(applied: AppliedTemplate | null): Set<string> {
  return new Set((applied?.items ?? []).filter(isKept).map((i) => i.field));
}

function isKept(item: AppliedTemplateItem): boolean {
  return item.status === "accepted" || item.status === "edited";
}

function itemAsFormValue(item: AppliedTemplateItem): string | RepeaterRow {
  const def = FIELD_DEFS[item.field];
  if (def.kind === "list_str") return item.values.text.trim();
  const row: RepeaterRow = {};
  if (def.kind === "list_obj") for (const sf of def.subfields) row[sf.name] = (item.values[sf.name] ?? "").trim();
  return row;
}

/** The generate payload with the template's kept items placed ahead of the user's own entries,
 * plus a decision for every offered item (pending items in a "Not applicable" field count as
 * removed). Pending items elsewhere must have been resolved before this is called. */
export function collectWithTemplate(
  collected: CollectedForm,
  applied: AppliedTemplate | null,
  domain: DomainSelection
): GeneratePayload {
  const payload: GeneratePayload = { ...collected };
  if (applied) {
    const form = { ...collected.form };
    for (const field of FIELD_ORDER) {
      const kept = applied.items.filter((i) => i.field === field && isKept(i));
      if (!kept.length || collected.excluded_sections.includes(field)) continue;
      const own = Array.isArray(form[field]) ? (form[field] as (string | RepeaterRow)[]) : [];
      form[field] = [...kept.map(itemAsFormValue), ...own] as string[] | RepeaterRow[];
    }
    payload.form = form;
    payload.template = {
      template_id: applied.template_id,
      version: applied.version,
      answers: applied.answers,
      // A field marked "Not applicable" sends none of its items, so all of them count as removed.
      decisions: Object.fromEntries(
        applied.items.map((i) => [
          i.key,
          i.status === "pending" || collected.excluded_sections.includes(i.field) ? "rejected" : (i.status as TemplateDecision),
        ])
      ),
    };
  } else if (domain) {
    payload.domain = toDomainPayload(domain);
  }
  return payload;
}

export function toDomainPayload(domain: NonNullable<DomainSelection>): DomainChoicePayload {
  return "domain_id" in domain ? { domain_id: domain.domain_id } : { other: domain.other.trim() };
}

/** When a template is removed or swapped: its accepted/edited items become the user's own
 * entries in the draft, so nothing the user approved is lost. */
export function releaseKeptItems(draft: DraftFormState, applied: AppliedTemplate | null): DraftFormState {
  if (!applied) return draft;
  const next = { ...draft };
  for (const item of applied.items.filter(isKept)) {
    const def = FIELD_DEFS[item.field];
    if (def.kind === "list_str") {
      const current = typeof next[item.field] === "string" ? (next[item.field] as string).trim() : "";
      next[item.field] = current ? `${item.values.text}\n${current}` : item.values.text;
    } else if (def.kind === "list_obj") {
      const row: DraftRepeaterRow = { ...emptyDraftRow(def), ...item.values };
      const rows = Array.isArray(next[item.field]) ? (next[item.field] as DraftRepeaterRow[]) : [];
      next[item.field] = [row, ...rows];
    }
  }
  return next;
}

export function keptItemCount(applied: AppliedTemplate | null): number {
  return (applied?.items ?? []).filter(isKept).length;
}

// ---------- Carrying a template into the document-upload flow ----------

/** What the user had set up on New Request before uploading documents: the template (with any
 * items already reviewed), the domain, and the fields they had typed themselves. The review page
 * picks this up so the documents fill in the rest instead of starting over. */
export interface StartingPoint {
  template: AppliedTemplate | null;
  domain: DomainSelection;
  typed: DraftFormState;
}

const STARTING_POINT_PREFIX = "brdAgentSuite.startingPoint.";
// Client-side navigation keeps this module alive, so the review page normally reads it from here;
// sessionStorage only matters if the user reloads the review page.
const startingPoints = new Map<string, StartingPoint>();

export function saveStartingPoint(extractionId: string, start: StartingPoint): void {
  startingPoints.set(extractionId, start);
  try {
    sessionStorage.setItem(STARTING_POINT_PREFIX + extractionId, JSON.stringify(start));
  } catch {
    // Storage unavailable — the in-memory copy still covers the normal (no reload) path.
  }
}

export function readStartingPoint(extractionId: string): StartingPoint | null {
  const inMemory = startingPoints.get(extractionId);
  if (inMemory) return inMemory;
  try {
    const raw = sessionStorage.getItem(STARTING_POINT_PREFIX + extractionId);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && "typed" in parsed) return parsed as StartingPoint;
  } catch {
    // Unreadable or unavailable — start from the documents alone.
  }
  return null;
}

// ---------- "Recently used" (a per-browser convenience only) ----------

const RECENT_KEY = "brdAgentSuite.recentTemplates";

export function readRecentTemplates(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string").slice(0, 4) : [];
  } catch {
    return [];
  }
}

export function rememberTemplate(templateId: string): void {
  try {
    const next = [templateId, ...readRecentTemplates().filter((id) => id !== templateId)].slice(0, 4);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private window, blocked) — the gallery just shows no recent row.
  }
}

// ---------- Labels ----------

export const TAG_LABELS: Record<TemplateTag, string> = {
  regulatory: "Regulatory",
  best_practice: "Best practice",
};

/** "Non-Functional Requirements: 4 · Risks: 3" style summary of what a template pre-fills. */
export function countsByLabel(counts: Record<string, number>): { field: string; label: string; count: number }[] {
  return FIELD_ORDER.filter((f) => counts[f]).map((f) => ({ field: f, label: FIELD_DEFS[f].label, count: counts[f] }));
}
