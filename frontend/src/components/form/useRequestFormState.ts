"use client";

import { useCallback, useState } from "react";
import { DraftFormState, DraftRepeaterRow, emptyDraftState } from "@/lib/formLogic";
import {
  AppliedTemplate,
  DomainSelection,
  TemplateItemStatus,
  acceptAllPending,
  releaseKeptItems,
  setItemStatus,
  setItemValues,
} from "@/lib/templateLogic";

/** The request form's editable state. Lifted into a hook so a page can share one draft between
 * the form and other panels, e.g. the review page's gap questions, which edit the same fields. */
export interface RequestFormState {
  draft: DraftFormState;
  autoFields: Record<string, boolean>;
  excludedFields: Record<string, boolean>;
  /** Fields the user has edited since the state was (re)loaded. */
  touched: Set<string>;
  /** The template the form was started from, with each offered item's review status. */
  template: AppliedTemplate | null;
  /** A blank start's optional domain (a template brings its own). */
  domain: DomainSelection;
  setValue: (name: string, value: string | DraftRepeaterRow[]) => void;
  toggleAuto: (name: string, checked: boolean) => void;
  toggleExclude: (name: string, checked: boolean) => void;
  /** Replaces the whole state. keepTouched carries edit-tracking over from before the reload. */
  load: (draft: DraftFormState, autoFields?: string[], keepTouched?: Set<string>) => void;
  /** Applies a template (or removes it, with null). Items the user already accepted or edited
   * from the previous template stay in the form as their own entries. */
  changeTemplate: (template: AppliedTemplate | null) => void;
  /** Restores a template and domain exactly as they were (e.g. carried over from New Request into
   * the document review page) — nothing is released into the draft. */
  restoreTemplate: (template: AppliedTemplate | null, domain: DomainSelection) => void;
  setTemplateItemValues: (key: string, values: Record<string, string>) => void;
  setTemplateItemStatus: (key: string, status: TemplateItemStatus) => void;
  acceptAllTemplateItems: (field?: string) => void;
  setDomain: (domain: DomainSelection) => void;
}

function toFlags(names: string[] = []): Record<string, boolean> {
  return Object.fromEntries(names.map((name) => [name, true]));
}

export function useRequestFormState(): RequestFormState {
  const [draft, setDraft] = useState<DraftFormState>(emptyDraftState);
  const [autoFields, setAutoFields] = useState<Record<string, boolean>>({});
  const [excludedFields, setExcludedFields] = useState<Record<string, boolean>>({});
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [template, setTemplate] = useState<AppliedTemplate | null>(null);
  const [domain, setDomain] = useState<DomainSelection>(null);

  const setValue = useCallback((name: string, value: string | DraftRepeaterRow[]) => {
    setDraft((prev) => ({ ...prev, [name]: value }));
    setTouched((prev) => (prev.has(name) ? prev : new Set(prev).add(name)));
  }, []);

  // Auto-generate and exclude are mutually exclusive: enriching a section and omitting it entirely
  // can't both be true at once.
  const toggleAuto = useCallback((name: string, checked: boolean) => {
    if (checked) setExcludedFields((prev) => ({ ...prev, [name]: false }));
    setAutoFields((prev) => ({ ...prev, [name]: checked }));
  }, []);

  const toggleExclude = useCallback((name: string, checked: boolean) => {
    if (checked) setAutoFields((prev) => ({ ...prev, [name]: false }));
    setExcludedFields((prev) => ({ ...prev, [name]: checked }));
  }, []);

  const load = useCallback((nextDraft: DraftFormState, nextAuto?: string[], keepTouched?: Set<string>) => {
    setDraft(nextDraft);
    setAutoFields(toFlags(nextAuto));
    setExcludedFields({});
    setTouched(new Set(keepTouched));
  }, []);

  const changeTemplate = useCallback(
    (next: AppliedTemplate | null) => {
      // Read the current template here rather than in a setState updater: releasing its kept
      // items updates the draft, and a nested setState inside an updater would run twice in
      // Strict Mode (duplicating those rows).
      setDraft((prev) => releaseKeptItems(prev, template));
      setTemplate(next);
      if (next) setDomain(null);
    },
    [template]
  );

  const restoreTemplate = useCallback((nextTemplate: AppliedTemplate | null, nextDomain: DomainSelection) => {
    setTemplate(nextTemplate);
    setDomain(nextTemplate ? null : nextDomain);
  }, []);

  const setTemplateItemValues = useCallback((key: string, values: Record<string, string>) => {
    setTemplate((prev) => (prev ? setItemValues(prev, key, values) : prev));
  }, []);

  const setTemplateItemStatus = useCallback((key: string, status: TemplateItemStatus) => {
    setTemplate((prev) => (prev ? setItemStatus(prev, key, status) : prev));
  }, []);

  const acceptAllTemplateItems = useCallback((field?: string) => {
    setTemplate((prev) => (prev ? acceptAllPending(prev, field) : prev));
  }, []);

  return {
    draft,
    autoFields,
    excludedFields,
    touched,
    template,
    domain,
    setValue,
    toggleAuto,
    toggleExclude,
    load,
    changeTemplate,
    restoreTemplate,
    setTemplateItemValues,
    setTemplateItemStatus,
    acceptAllTemplateItems,
    setDomain,
  };
}
