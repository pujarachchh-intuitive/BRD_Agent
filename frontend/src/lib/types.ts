// Mirrors webapp/service.py's FORM_FIELDS kinds and the JSON shapes returned by
// /api/generate, /api/runs/{id}/revise and GET /api/runs/{id}.

export type FieldKind = "scalar" | "list_str" | "list_obj";

export interface SubfieldDef {
  name: string;
  label: string;
  type: "text" | "textarea" | "select";
  placeholder?: string;
  options?: string[];
  default?: string;
  /** Comma-separated in the UI, stored as string[] */
  isList?: boolean;
}

interface FieldDefBase {
  kind: FieldKind;
  label: string;
  helper?: string;
  /** Foundational identity field: no auto-generate, no exclude, always required. */
  critical?: boolean;
  /** Must always appear per the reference docs: no exclude option, but auto-generate is available. */
  noExclude?: boolean;
  /** additional_sections only: neither auto-generate nor exclude applies. */
  skipToggles?: boolean;
}

export interface ScalarFieldDef extends FieldDefBase {
  kind: "scalar";
  input: "text" | "textarea";
  placeholder?: string;
  prominent?: boolean;
}

export interface ListStrFieldDef extends FieldDefBase {
  kind: "list_str";
}

export interface ListObjFieldDef extends FieldDefBase {
  kind: "list_obj";
  subfields: SubfieldDef[];
}

export type FieldDef = ScalarFieldDef | ListStrFieldDef | ListObjFieldDef;

export interface FormSection {
  title: string;
  fields: string[];
}

export type RepeaterRow = Record<string, string | string[]>;
export type FieldValue = string | string[] | RepeaterRow[];
export type FormState = Record<string, FieldValue>;

export interface GeneratePayload {
  form: FormState;
  auto_fields: string[];
  excluded_sections: string[];
}

export interface RunDocuments {
  brd_markdown: string | null;
  tsd_markdown: string | null;
  flowchart_mermaid: string | null;
  architecture_mermaid: string | null;
  onepager_markdown: string | null;
}

export interface RequirementsJson {
  project_name?: string;
  assumptions?: string[];
  // Loosely typed — only used for the results-page summary chip counts, never destructured deeper.
  objectives?: unknown[];
  functional_requirements?: unknown[];
  risks?: unknown[];
  timeline_phases?: unknown[];
  [key: string]: unknown;
}

export interface RunResult {
  run_id: string;
  requirements_json: RequirementsJson;
  documents: RunDocuments;
  consistency_report: string | null;
  parent_run_id?: string | null;
}

export interface RunHistoryEntry {
  run_id: string;
  project_name?: string | null;
  parent_run_id?: string | null;
  created_at: string;
}

/** One entry from GET /api/runs — every run ever written to disk, whether it came from this
 * webapp's form or from `adk web`/`adk run` directly. No parent_run_id: that link only exists in
 * this frontend's localStorage, for runs created through it. */
export interface BackendRunSummary {
  run_id: string;
  project_name: string | null;
}

export type DiagramKey = "architecture" | "flowchart";
