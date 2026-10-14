// API calls to the FastAPI backend. Requests go through relative "/api/..." paths — proxied to
// the backend by the rewrite in next.config.ts, so this code is identical in dev and prod.

import {
  AdminTemplate,
  AdminTemplateDetail,
  AuthUser,
  BackendRunSummary,
  DiagramKey,
  DocumentGenerationResult,
  Domain,
  ExtractionResult,
  GeneratePayload,
  Job,
  PublishedTemplate,
  RunResult,
  TemplateContent,
  TemplateMetaInput,
  TemplateSchema,
  TemplateVersion,
} from "./types";

async function handleJsonResponse<T>(res: Response): Promise<T> {
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const detail =
      data && typeof data === "object" && "detail" in data ? String((data as { detail: unknown }).detail) : `Request failed (${res.status})`;
    // A session that expired mid-use (cookie gone/invalid) shows up as a 401 on whatever request
    // happened to run next — send the user back to /login rather than surfacing a raw API error.
    if (res.status === 401 && typeof window !== "undefined" && window.location.pathname !== "/login") {
      window.location.assign("/login");
    }
    throw new Error(detail);
  }
  return data as T;
}

export async function apiRegister(name: string, email: string, password: string): Promise<AuthUser> {
  const res = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password }),
  });
  return handleJsonResponse<AuthUser>(res);
}

export async function apiLogin(email: string, password: string): Promise<AuthUser> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return handleJsonResponse<AuthUser>(res);
}

export async function apiLogout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}

export async function apiMe(): Promise<AuthUser | null> {
  const res = await fetch("/api/auth/me");
  if (res.status === 401) return null;
  return handleJsonResponse<AuthUser>(res);
}

export async function apiGenerate(payload: GeneratePayload): Promise<RunResult> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleJsonResponse<RunResult>(res);
}

export async function apiRevise(runId: string, changeRequest: string): Promise<RunResult> {
  const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/revise`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ change_request: changeRequest }),
  });
  return handleJsonResponse<RunResult>(res);
}

export async function apiListRuns(): Promise<BackendRunSummary[]> {
  const res = await fetch("/api/runs");
  const data = await handleJsonResponse<{ runs: BackendRunSummary[] }>(res);
  return data.runs;
}

export async function apiGetRun(runId: string): Promise<RunResult> {
  const res = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
  return handleJsonResponse<RunResult>(res);
}

export async function apiUploadDiagrams(runId: string, payload: Record<string, string>): Promise<{ saved: string[] }> {
  const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/diagrams`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleJsonResponse<{ saved: string[] }>(res);
}

/** Starts extracting a project from uploaded documents. Passing extractionId adds the files to
 * that earlier extraction's files and extracts again from all of them. */
export async function apiExtractDocuments(
  files: File[],
  options: { extractionId?: string; projectId?: string } = {}
): Promise<Job<ExtractionResult>> {
  const body = new FormData();
  for (const file of files) body.append("files", file, file.name);
  if (options.extractionId) body.append("extraction_id", options.extractionId);
  if (options.projectId) body.append("project_id", options.projectId);
  // No Content-Type header: the browser sets the multipart boundary itself.
  const res = await fetch("/api/documents/extract", { method: "POST", body });
  return handleJsonResponse<Job<ExtractionResult>>(res);
}

export async function apiGetExtraction(extractionId: string): Promise<ExtractionResult> {
  const res = await fetch(`/api/documents/extractions/${encodeURIComponent(extractionId)}`);
  return handleJsonResponse<ExtractionResult>(res);
}

export async function apiGenerateFromExtraction(
  extractionId: string,
  payload: GeneratePayload
): Promise<Job<DocumentGenerationResult>> {
  const res = await fetch(`/api/documents/extractions/${encodeURIComponent(extractionId)}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleJsonResponse<Job<DocumentGenerationResult>>(res);
}

export async function apiGetJob<TResult>(jobId: string): Promise<Job<TResult>> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
  return handleJsonResponse<Job<TResult>>(res);
}

const JOB_POLL_INTERVAL_MS = 2500;

/** Polls a job until it finishes, reporting every update. Resolves with the result; rejects with
 * the job's error message if it failed. A few consecutive network errors are tolerated, since a
 * long job easily outlives a brief connection blip. */
export async function waitForJob<TResult>(
  initial: Job<TResult>,
  onUpdate: (job: Job<TResult>) => void,
  signal?: AbortSignal
): Promise<TResult> {
  let job = initial;
  let failures = 0;
  onUpdate(job);
  while (job.status === "running") {
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));
    if (signal?.aborted) throw new Error("Cancelled");
    try {
      job = await apiGetJob<TResult>(job.job_id);
      failures = 0;
      onUpdate(job);
    } catch (err) {
      failures += 1;
      if (failures >= 4) throw err;
    }
  }
  if (job.status === "failed" || job.result === null) {
    throw new Error(job.error || "Something went wrong. Please try again.");
  }
  return job.result;
}

// ---------- Domain templates ----------

/** FastAPI's 422 for a body that fails validation has a list `detail`; turn it into one line. */
async function handleTemplateResponse<T>(res: Response): Promise<T> {
  if (res.status === 422) {
    let detail: unknown = null;
    try {
      detail = (await res.clone().json())?.detail;
    } catch {
      detail = null;
    }
    if (Array.isArray(detail)) {
      const messages = detail.map((d) => String(d?.msg ?? d).replace(/^Value error, /, ""));
      throw new Error(messages.join(" · "));
    }
  }
  return handleJsonResponse<T>(res);
}

function jsonRequest(method: string, body?: unknown): RequestInit {
  return body === undefined
    ? { method }
    : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export async function apiListTemplates(): Promise<PublishedTemplate[]> {
  const data = await handleJsonResponse<{ templates: PublishedTemplate[] }>(await fetch("/api/templates"));
  return data.templates;
}

export async function apiListDomains(): Promise<Domain[]> {
  const data = await handleJsonResponse<{ domains: Domain[] }>(await fetch("/api/domains"));
  return data.domains;
}

export async function apiAdminTemplateSchema(): Promise<TemplateSchema> {
  return handleJsonResponse<TemplateSchema>(await fetch("/api/admin/templates/schema"));
}

export async function apiAdminListTemplates(): Promise<AdminTemplate[]> {
  const data = await handleJsonResponse<{ templates: AdminTemplate[] }>(await fetch("/api/admin/templates"));
  return data.templates;
}

export async function apiAdminCreateTemplate(meta: TemplateMetaInput): Promise<AdminTemplateDetail> {
  return handleTemplateResponse(await fetch("/api/admin/templates", jsonRequest("POST", meta)));
}

export async function apiAdminGetTemplate(templateId: string): Promise<AdminTemplateDetail> {
  return handleJsonResponse(await fetch(`/api/admin/templates/${encodeURIComponent(templateId)}`));
}

export async function apiAdminUpdateTemplate(templateId: string, meta: TemplateMetaInput): Promise<AdminTemplateDetail> {
  return handleTemplateResponse(await fetch(`/api/admin/templates/${encodeURIComponent(templateId)}`, jsonRequest("PUT", meta)));
}

export async function apiAdminSaveDraft(templateId: string, content: TemplateContent, changeNote: string): Promise<AdminTemplateDetail> {
  return handleTemplateResponse(
    await fetch(
      `/api/admin/templates/${encodeURIComponent(templateId)}/draft`,
      jsonRequest("PUT", { content, change_note: changeNote })
    )
  );
}

export async function apiAdminPublish(templateId: string, changeNote: string): Promise<AdminTemplateDetail> {
  return handleTemplateResponse(
    await fetch(`/api/admin/templates/${encodeURIComponent(templateId)}/publish`, jsonRequest("POST", { change_note: changeNote }))
  );
}

export async function apiAdminGetVersion(templateId: string, version: number): Promise<TemplateVersion> {
  return handleJsonResponse(await fetch(`/api/admin/templates/${encodeURIComponent(templateId)}/versions/${version}`));
}

export async function apiAdminRestoreVersion(templateId: string, version: number): Promise<AdminTemplateDetail> {
  return handleTemplateResponse(
    await fetch(`/api/admin/templates/${encodeURIComponent(templateId)}/versions/${version}/restore`, jsonRequest("POST"))
  );
}

export async function apiAdminSetTemplateStatus(templateId: string, action: "retire" | "reactivate"): Promise<AdminTemplateDetail> {
  return handleJsonResponse(await fetch(`/api/admin/templates/${encodeURIComponent(templateId)}/${action}`, jsonRequest("POST")));
}

export async function apiAdminListDomains(): Promise<Domain[]> {
  const data = await handleJsonResponse<{ domains: Domain[] }>(await fetch("/api/admin/domains"));
  return data.domains;
}

export async function apiAdminCreateDomain(name: string): Promise<Domain> {
  return handleTemplateResponse(await fetch("/api/admin/domains", jsonRequest("POST", { name })));
}

export async function apiAdminUpdateDomain(
  domainId: string,
  changes: Partial<Pick<Domain, "name" | "is_active" | "sort_order">>
): Promise<Domain> {
  return handleTemplateResponse(await fetch(`/api/admin/domains/${encodeURIComponent(domainId)}`, jsonRequest("PATCH", changes)));
}

/** One page's worth of a diagram for the DOCX export (see diagramLayout.ts). */
export interface ExportDiagramPart {
  png: string; // data:image/png;base64,...
  width_pt: number;
  height_pt: number;
  label: string;
}

/** `diagrams` carries each diagram already split into page-sized images; the backend falls back to
 * the uploaded full-size PNG for any diagram left out. */
export async function apiExportDocx(
  runId: string,
  doc: string,
  diagrams: Partial<Record<DiagramKey, ExportDiagramPart[]>> = {}
): Promise<Blob> {
  const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/export/${doc}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ diagrams }),
  });
  if (!res.ok) {
    let detail = `Export failed (${res.status})`;
    try {
      const data = await res.json();
      if (data && data.detail) detail = data.detail;
    } catch {
      // response wasn't JSON — keep the generic message
    }
    if (res.status === 401 && typeof window !== "undefined" && window.location.pathname !== "/login") {
      window.location.assign("/login");
    }
    throw new Error(detail);
  }
  return res.blob();
}
