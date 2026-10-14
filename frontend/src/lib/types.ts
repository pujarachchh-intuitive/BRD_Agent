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
  /** Set when the form was started from a template: what the user did with every item it offered. */
  template?: TemplateUsagePayload;
  /** The optional domain chosen on a blank start (a template brings its own). */
  domain?: DomainChoicePayload;
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

// ---------- Document upload flow (webapp/ingestion/) ----------

/** One background job from GET /api/jobs/{id} (webapp/jobs.py). */
export interface Job<TResult = unknown> {
  job_id: string;
  kind: "document_extraction" | "document_generation";
  status: "running" | "succeeded" | "failed";
  stage: string;
  progress: string[];
  result: TResult | null;
  error: string | null;
}

/** Mirrors webapp/ingestion/verify.py's review states. */
export type ReviewState = "found" | "confirm" | "blocking" | "auto" | "optional";

export interface Evidence {
  file: string;
  location: string;
  quote: string;
  /** null: the source is a scanned PDF, so the quote couldn't be checked. */
  verified: boolean | null;
}

export interface FieldReview {
  field: string;
  label: string;
  state: ReviewState;
  status: "found" | "partial" | "inferred" | "missing";
  confidence: "high" | "medium" | "low";
  reason: string;
  note: string;
  evidence: Evidence[];
}

export interface ExtractionConflict {
  field: string;
  description: string;
  options: { value: string; file: string; location: string }[];
}

export interface GapQuestion {
  field: string;
  question: string;
  suggested_answers: string[];
}

export interface ExtractedFile {
  file_name: string;
  kind: "pdf" | "docx" | "txt" | "md";
  page_count: number | null;
  size_bytes: number;
  scanned: boolean;
}

/** GET /api/documents/extractions/{id}, also the result of an extraction job. */
export interface ExtractionResult {
  extraction_id: string;
  project_id: string;
  project_name: string;
  created_at: string;
  mode: "single" | "per_document";
  files: ExtractedFile[];
  /** Same shape as GeneratePayload.form, with no IDs on list items. */
  form: FormState;
  fields: FieldReview[];
  blocking: string[];
  confirm: string[];
  auto_fields: string[];
  conflicts: ExtractionConflict[];
  gap_questions: GapQuestion[];
  summary: string;
}

export interface DocumentGenerationResult {
  run_id: string;
  project_id: string;
  project_name: string;
}

// ---------- Domain templates (webapp/doc_templates/) ----------

/** "regulatory": required by a named law, regulation or mandatory standard. "best_practice":
 * widely accepted industry practice, not legally required. */
export type TemplateTag = "regulatory" | "best_practice";

export interface TemplateItem {
  key: string;
  /** Subfield name -> value for list_obj fields; { text } for list_str fields. */
  values: Record<string, string>;
  tag: TemplateTag;
  source: string;
  source_url: string | null;
  /** Only offered when the user answers this applicability question "yes". */
  applies_if: string | null;
}

export interface TemplateQuestion {
  key: string;
  text: string;
  default: boolean;
}

export interface TemplateContent {
  domain_guidance: string;
  questions: TemplateQuestion[];
  items: Record<string, TemplateItem[]>;
}

/** GET /api/templates entry: a template's current published version. */
export interface PublishedTemplate {
  template_id: string;
  slug: string;
  name: string;
  domain_id: string;
  domain_name: string;
  description: string;
  icon: string;
  color: string;
  version: number;
  published_at: string | null;
  counts: Record<string, number>;
  content: TemplateContent;
}

export interface Domain {
  domain_id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export type TemplateDecision = "accepted" | "edited" | "rejected";

export interface TemplateUsagePayload {
  template_id: string;
  version: number;
  answers: Record<string, boolean>;
  decisions: Record<string, TemplateDecision>;
}

export type DomainChoicePayload = { domain_id: string } | { other: string };

// Template Studio (admin)

export interface AdminTemplate {
  template_id: string;
  slug: string;
  name: string;
  domain_id: string;
  domain_name: string;
  description: string;
  icon: string;
  color: string;
  status: "ACTIVE" | "RETIRED";
  published_version: number | null;
  draft_version: number | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface TemplateVersionSummary {
  version: number;
  status: "DRAFT" | "PUBLISHED";
  change_note: string;
  created_by: string | null;
  created_at: string | null;
  updated_by: string | null;
  updated_at: string | null;
  published_by: string | null;
  published_at: string | null;
}

export interface TemplateVersion extends TemplateVersionSummary {
  content: TemplateContent;
}

export interface AdminTemplateDetail {
  template: AdminTemplate;
  versions: TemplateVersionSummary[];
  draft: TemplateVersion | null;
  published: TemplateVersion | null;
}

export interface TemplateMetaInput {
  name: string;
  domain_id: string;
  description: string;
  icon: string;
  color: string;
}

/** GET /api/admin/templates/schema: field name -> the value names its items need. */
export interface TemplateSchema {
  fields: Record<string, string[]>;
  icons: string[];
}

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
