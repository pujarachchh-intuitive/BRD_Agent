// Pure helpers for building the /api/generate payload from the form's draft state, and for
// validating it before submit. Ported 1:1 from webapp/static/app.js (collectFormData,
// isFieldValueEmpty, validateRequiredFields) but split so the draft (what's literally typed,
// including raw comma/newline-separated text) is converted to the API shape only at submit time —
// matching the original, which only split textarea/comma text into arrays when collecting the form,
// never while the user was still typing.

import { FIELD_DEFS, FORM_SECTIONS } from "./formConfig";
import { FieldDef, FieldValue, FormState, GeneratePayload } from "./types";

/** One repeater row's raw subfield text, keyed by subfield name — always a string, even for
 * isList subfields (comma-separated), until buildGeneratePayload splits it. */
export type DraftRepeaterRow = Record<string, string>;

/** scalar & list_str fields are a single raw string (the literal textarea/input value) until
 * submit; list_obj fields are an array of draft rows. */
export type DraftFormState = Record<string, string | DraftRepeaterRow[]>;

export function emptyDraftRow(def: FieldDef): DraftRepeaterRow {
  const row: DraftRepeaterRow = {};
  if (def.kind !== "list_obj") return row;
  for (const sf of def.subfields) {
    row[sf.name] = sf.type === "select" ? sf.default ?? sf.options?.[0] ?? "" : "";
  }
  return row;
}

export function emptyDraftState(): DraftFormState {
  const draft: DraftFormState = {};
  for (const [name, def] of Object.entries(FIELD_DEFS)) {
    draft[name] = def.kind === "list_obj" ? [] : "";
  }
  return draft;
}

function buildFieldValue(def: FieldDef, draftValue: string | DraftRepeaterRow[]): FieldValue {
  if (def.kind === "scalar") {
    return typeof draftValue === "string" ? draftValue.trim() : "";
  }
  if (def.kind === "list_str") {
    const raw = typeof draftValue === "string" ? draftValue : "";
    return raw
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  // list_obj
  const rows = Array.isArray(draftValue) ? draftValue : [];
  return rows.map((row) => {
    const obj: Record<string, string | string[]> = {};
    for (const sf of def.subfields) {
      const raw = row[sf.name] ?? "";
      obj[sf.name] = sf.isList
        ? raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : raw.trim();
    }
    return obj;
  });
}

export interface CollectedForm {
  form: FormState;
  auto_fields: string[];
  excluded_sections: string[];
}

export function collectFormData(draft: DraftFormState, autoFields: Set<string>, excludedFields: Set<string>): CollectedForm {
  const form: FormState = {};
  for (const [name, def] of Object.entries(FIELD_DEFS)) {
    form[name] = buildFieldValue(def, draft[name]);
  }
  return {
    form,
    auto_fields: [...autoFields],
    excluded_sections: [...excludedFields],
  };
}

export function toGeneratePayload(collected: CollectedForm): GeneratePayload {
  return collected;
}

function isFieldValueEmpty(value: FieldValue, def: FieldDef): boolean {
  if (def.kind === "scalar") return !value;
  const list = value as unknown[];
  return (
    !Array.isArray(list) ||
    list.length === 0 ||
    list.every((item) =>
      typeof item === "string"
        ? !item.trim()
        : Object.values(item as Record<string, string | string[]>).every((v) => !v || (Array.isArray(v) && !v.length))
    )
  );
}

/** Auto-generate means "enrich a seed," not "invent from nothing" — so every field needs at least
 * one real point from the user before submission, not just the critical ones. The two exceptions:
 * a field the user explicitly marked "not applicable," and additional_sections (genuinely optional).
 * Checking "auto-generate" does not exempt a field from this. */
export function validateRequiredFields(form: FormState, excludedSections: string[]): string | null {
  const excluded = new Set(excludedSections);
  const missing: string[] = [];
  for (const [name, def] of Object.entries(FIELD_DEFS)) {
    if (def.skipToggles || excluded.has(name)) continue;
    if (isFieldValueEmpty(form[name], def)) missing.push(def.label);
  }
  if (!missing.length) return null;
  return (
    'Please add at least one point to every field before generating (or mark it "Not applicable" ' +
    `if it genuinely doesn't apply): ${missing.join(", ")}.`
  );
}

/** Loose "has something in it" check for a draft field — used only for the section-nav progress
 * dots, not for submit validation (validateRequiredFields is the authoritative check). */
export function isDraftValueFilled(value: string | DraftRepeaterRow[] | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return value.some((row) => Object.values(row).some((v) => v.trim().length > 0));
}

/** Stricter than isDraftValueFilled: a repeater row only counts if one of its typed cells has
 * text, since a fresh row's dropdowns (e.g. priority "M") are pre-filled. Used to decide whether
 * a required field on the review page has really been answered. */
export function isDraftFieldAnswered(def: FieldDef, value: string | DraftRepeaterRow[] | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (def.kind !== "list_obj") return false;
  const typed = def.subfields.filter((sf) => sf.type !== "select").map((sf) => sf.name);
  return value.some((row) => typed.some((name) => (row[name] ?? "").trim().length > 0));
}

/** The inverse of collectFormData: an API-shaped form (e.g. one extracted from uploaded
 * documents) as the draft the form edits. */
export function formToDraft(form: FormState): DraftFormState {
  const draft = emptyDraftState();
  for (const [name, def] of Object.entries(FIELD_DEFS)) {
    const value = form[name];
    if (def.kind === "scalar") {
      draft[name] = typeof value === "string" ? value : "";
    } else if (def.kind === "list_str") {
      draft[name] = Array.isArray(value) ? (value as string[]).filter((v) => typeof v === "string").join("\n") : "";
    } else {
      const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
      draft[name] = rows
        .filter((row) => row && typeof row === "object")
        .map((row) => {
          const out = emptyDraftRow(def);
          for (const sf of def.subfields) {
            const cell = row[sf.name];
            if (Array.isArray(cell)) out[sf.name] = cell.join(", ");
            else if (typeof cell === "string" && (sf.type !== "select" || sf.options?.includes(cell))) out[sf.name] = cell;
          }
          return out;
        });
    }
  }
  return draft;
}

/** Adds a one-click suggested answer to a draft field: replaces a scalar, appends a line to a
 * list, or appends a row to a repeater. A row suggestion written as "Role: interest" (or with an
 * em dash) fills the row's first two cells. */
export function applySuggestion(def: FieldDef, current: string | DraftRepeaterRow[], suggestion: string): string | DraftRepeaterRow[] {
  if (def.kind === "scalar") return suggestion;
  if (def.kind === "list_str") {
    const existing = typeof current === "string" ? current.trim() : "";
    return existing ? `${existing}\n${suggestion}` : suggestion;
  }
  const row = emptyDraftRow(def);
  const textCells = def.subfields.filter((sf) => sf.type !== "select");
  const match = suggestion.match(/^(.+?)\s*(?::|—|–| - )\s*(.+)$/);
  if (match && textCells.length >= 2) {
    row[textCells[0].name] = match[1].trim();
    row[textCells[1].name] = match[2].trim();
  } else if (textCells.length) {
    row[textCells[0].name] = suggestion;
  }
  return [...(Array.isArray(current) ? current : []), row];
}

/** Review-page submit: like collectFormData, except that any non-excluded field still empty is
 * handed to the AI (auto-generate) rather than blocking submission — the uploaded documents are
 * the grounding the regular form's "add at least one point" rule otherwise asks the user for.
 * Blocking fields are checked separately, before this is ever called. */
export function collectReviewedForm(draft: DraftFormState, autoFields: Set<string>, excludedFields: Set<string>): CollectedForm {
  const collected = collectFormData(draft, autoFields, excludedFields);
  const auto = new Set(collected.auto_fields);
  for (const [name, def] of Object.entries(FIELD_DEFS)) {
    if (def.skipToggles || def.critical || excludedFields.has(name)) continue;
    if (isFieldValueEmpty(collected.form[name], def)) auto.add(name);
  }
  return { ...collected, auto_fields: [...auto] };
}

export { FIELD_DEFS, FORM_SECTIONS };
