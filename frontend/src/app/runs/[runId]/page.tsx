"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import TopBar from "@/components/layout/TopBar";
import ErrorBanner from "@/components/ErrorBanner";
import LoadingSection from "@/components/LoadingSection";
import ResultsView from "@/components/results/ResultsView";
import { apiGetRun, apiRevise } from "@/lib/api";
import { addRunToHistory } from "@/lib/runHistory";
import { RunResult } from "@/lib/types";

// Keyed by the runId it was fetched for, and only ever written from the fetch's own then/catch
// (never synchronously at the top of the effect) — so "loading" and "stale data from the previous
// runId" are derived below by comparing runId to fetchResult.runId, rather than tracked as their
// own imperatively-reset state.
interface FetchResult {
  runId: string;
  data: RunResult | null;
  error: string | null;
}

export default function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const router = useRouter();
  const [fetchResult, setFetchResult] = useState<FetchResult | null>(null);
  const [reviseError, setReviseError] = useState<string | null>(null);
  const [reviseLoading, setReviseLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiGetRun(runId)
      .then((data) => {
        if (cancelled) return;
        // So a run loaded directly by ID (e.g. from adk, or a shared link) shows up in the
        // dropdown/history on future visits too.
        addRunToHistory({ run_id: data.run_id, project_name: data.requirements_json.project_name, parent_run_id: null });
        setFetchResult({ runId, data, error: null });
      })
      .catch((err) => {
        if (!cancelled) setFetchResult({ runId, data: null, error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const isCurrent = fetchResult?.runId === runId;
  const isLoading = !isCurrent;
  const data = isCurrent ? fetchResult.data : null;
  const loadError = isCurrent ? fetchResult.error : null;
  const errorMessage = reviseError ?? loadError;

  async function handleRevise(changeRequest: string): Promise<boolean> {
    if (!changeRequest) {
      setReviseError("Please describe the change you'd like before applying it.");
      return false;
    }
    setReviseError(null);
    setReviseLoading(true);
    try {
      const result = await apiRevise(runId, changeRequest);
      addRunToHistory({ run_id: result.run_id, project_name: result.requirements_json.project_name, parent_run_id: result.parent_run_id });
      router.push(`/runs/${result.run_id}`);
      return true;
    } catch (err) {
      setReviseError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setReviseLoading(false);
    }
  }

  return (
    <>
      <TopBar title={data?.requirements_json.project_name || (isLoading ? "Loading run…" : "Run not found")} />
      <div className="app-content">
        <ErrorBanner message={errorMessage} />
        <LoadingSection visible={reviseLoading} message="Applying your change — this usually takes 30-90 seconds..." />
        {isLoading ? (
          <div className="flex flex-col gap-4">
            <div className="skeleton" style={{ height: 130 }} />
            <div className="skeleton" style={{ height: 44 }} />
            <div className="skeleton" style={{ height: 420 }} />
          </div>
        ) : data ? (
          <ResultsView data={data} disabled={reviseLoading} onError={setReviseError} onRevise={handleRevise} />
        ) : (
          !errorMessage && <p style={{ color: "var(--color-text-muted)" }}>This run could not be found.</p>
        )}
      </div>
    </>
  );
}
