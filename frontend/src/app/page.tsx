"use client";

import { useEffect, useRef, useState } from "react";
import ErrorBanner from "@/components/ErrorBanner";
import Header from "@/components/Header";
import LoadingSection from "@/components/LoadingSection";
import RequestForm from "@/components/form/RequestForm";
import ResultsView from "@/components/results/ResultsView";
import { apiGenerate, apiGetRun, apiListRuns, apiRevise } from "@/lib/api";
import { CollectedForm } from "@/lib/formLogic";
import { addRunToHistory, loadRunHistory, mergeRunHistory } from "@/lib/runHistory";
import { RunHistoryEntry, RunResult } from "@/lib/types";

export default function Home() {
  const [currentData, setCurrentData] = useState<RunResult | null>(null);
  const [runHistory, setRunHistory] = useState<RunHistoryEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    refreshRunHistory();
  }, []);

  useEffect(() => {
    if (errorMessage) errorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [errorMessage]);

  useEffect(() => {
    if (currentData) resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [currentData]);

  function showError(err: unknown) {
    setErrorMessage(err instanceof Error ? err.message : String(err));
  }

  // Persists to localStorage only — the run/revision-parent link never lives on the backend, so
  // this is just to enrich the authoritative list refreshRunHistory() fetches right after.
  function recordRunLocally(entry: { run_id: string; project_name?: string | null; parent_run_id?: string | null }) {
    addRunToHistory(entry);
  }

  // GET /api/runs is authoritative for "every run that exists" — covers runs made through this
  // form AND ones made via `adk web`/`adk run` directly, since both write to the same output
  // directory. Best-effort: if it fails, just leave the dropdown showing whatever it already had.
  async function refreshRunHistory() {
    try {
      const backendRuns = await apiListRuns();
      setRunHistory(mergeRunHistory(backendRuns, loadRunHistory()));
    } catch {
      // best-effort — a failed refresh isn't worth surfacing as an error banner
    }
  }

  async function handleGenerate(collected: CollectedForm) {
    setIsLoading(true);
    setLoadingMessage("Generating your documents — this usually takes 30-90 seconds...");
    try {
      const data = await apiGenerate(collected);
      recordRunLocally({ run_id: data.run_id, project_name: data.requirements_json.project_name, parent_run_id: null });
      await refreshRunHistory();
      setCurrentData(data);
    } catch (err) {
      showError(err);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRevise(changeRequest: string): Promise<boolean> {
    if (!changeRequest) {
      setErrorMessage("Please describe the change you'd like before applying it.");
      return false;
    }
    if (!currentData) {
      setErrorMessage("No active run to revise.");
      return false;
    }
    setErrorMessage(null);
    setIsLoading(true);
    setLoadingMessage("Applying your change — this usually takes 30-90 seconds...");
    try {
      const data = await apiRevise(currentData.run_id, changeRequest);
      recordRunLocally({ run_id: data.run_id, project_name: data.requirements_json.project_name, parent_run_id: data.parent_run_id });
      await refreshRunHistory();
      setCurrentData(data);
      return true;
    } catch (err) {
      showError(err);
      return false;
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSelectRun(runId: string) {
    setErrorMessage(null);
    setIsLoading(true);
    setLoadingMessage("Loading run...");
    try {
      const data = await apiGetRun(runId);
      setCurrentData(data);
    } catch (err) {
      showError(err);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleLoadRunId(runId: string) {
    setErrorMessage(null);
    setIsLoading(true);
    setLoadingMessage("Loading run...");
    try {
      const data = await apiGetRun(runId);
      setCurrentData(data);
      // Runs loaded via adk are already in the backend's list — refreshRunHistory() below picks
      // them up regardless. This local write is just so localStorage has an entry to enrich from.
      recordRunLocally({ run_id: data.run_id, project_name: data.requirements_json.project_name, parent_run_id: null });
      await refreshRunHistory();
    } catch (err) {
      showError(err);
    } finally {
      setIsLoading(false);
    }
  }

  function handleNewRequest() {
    setCurrentData(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <>
      <Header
        runHistory={runHistory}
        currentRunId={currentData?.run_id ?? null}
        disabled={isLoading}
        showNewRequest={!!currentData}
        onSelectRun={handleSelectRun}
        onLoadRunId={handleLoadRunId}
        onNewRequest={handleNewRequest}
      />

      <main className="mx-auto max-w-4xl px-6 py-8 pb-16">
        <ErrorBanner ref={errorRef} message={errorMessage} />
        <LoadingSection visible={isLoading} message={loadingMessage} />

        {currentData ? (
          <div ref={resultsRef}>
            <ResultsView data={currentData} disabled={isLoading} onError={(msg) => setErrorMessage(msg)} onRevise={handleRevise} />
          </div>
        ) : (
          <RequestForm
            disabled={isLoading}
            onSubmit={handleGenerate}
            onValidationError={(msg) => setErrorMessage(msg)}
            onClearError={() => setErrorMessage(null)}
          />
        )}
      </main>
    </>
  );
}
