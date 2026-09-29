// API calls to the FastAPI backend. Requests go through relative "/api/..." paths — proxied to
// the backend by the rewrite in next.config.ts, so this code is identical in dev and prod.

import { AuthUser, BackendRunSummary, GeneratePayload, RunResult } from "./types";

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

export async function apiExportDocx(runId: string, doc: string): Promise<Blob> {
  const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/export/${doc}`, { method: "POST" });
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
