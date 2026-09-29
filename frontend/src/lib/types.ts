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
  /** Optional: generate into an existing project instead of auto-creating a new one. The
   * backend re-verifies ownership regardless — this is never trusted as the source of ownership. */
  project_id?: string;
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
  /** The project this run was generated/revised against — set server-side (webapp/service.py),
   * never something the frontend chooses ownership from. */
  project_id?: string;
}

export interface RunHistoryEntry {
  run_id: string;
  project_name?: string | null;
  parent_run_id?: string | null;
  created_at: string;
}

/** One entry from GET /api/runs — every run ever written to disk, whether it came from this
 * webapp's form or from `adk web`/`adk run` directly.
 *
 * duration_seconds/total_tokens/estimated_cost_usd/cost_by_agent are all nullable/empty for any
 * run generated before that instrumentation existed (run_meta.json / logs/<run_id>.jsonl) — never
 * treat a missing value as zero when aggregating for dashboard stats. */
export interface BackendRunSummary {
  run_id: string;
  project_name: string | null;
  duration_seconds: number | null;
  total_tokens: number | null;
  estimated_cost_usd: number | null;
  cost_by_agent: Record<string, number>;
  /** The run this one was a "request a change" revision of, if any — persisted server-side in
   * run_meta.json (only from when that was added; an older revision has no recoverable parent and
   * shows up as its own top-level entry). Powers the History page's run/revision grouping. */
  parent_run_id: string | null;
  /** From consistency_report.md, present for every run (unlike the fields above) — null only if
   * the report file itself is somehow missing. */
  consistency_status: "pass" | "issues" | null;
}

export type DiagramKey = "architecture" | "flowchart";

// Mirrors webapp/auth/schemas.py's UserPublic — GET/POST /api/auth/* never return password_hash.
export type UserRole = "USER" | "ADMIN";
export type UserStatus = "ACTIVE" | "INACTIVE";

export interface AuthUser {
  user_id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
}
