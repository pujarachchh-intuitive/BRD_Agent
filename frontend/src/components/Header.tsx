"use client";

import { useState } from "react";
import { RunHistoryEntry } from "@/lib/types";

interface HeaderProps {
  runHistory: RunHistoryEntry[];
  currentRunId: string | null;
  disabled: boolean;
  showNewRequest: boolean;
  onSelectRun: (runId: string) => void;
  onLoadRunId: (runId: string) => void;
  onNewRequest: () => void;
}

export default function Header({ runHistory, currentRunId, disabled, showNewRequest, onSelectRun, onLoadRunId, onNewRequest }: HeaderProps) {
  const [runIdInput, setRunIdInput] = useState("");

  return (
    <header className="sticky top-0 z-20 border-b bg-[var(--color-surface)] shadow-sm" style={{ borderColor: "var(--color-border)" }}>
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4 px-6 py-3.5">
        <h1 className="m-0 text-xl font-semibold" style={{ color: "var(--color-primary-dark)" }}>
          BRD Agent Suite
        </h1>
        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Load a previous run"
            className="field-input min-w-[220px] cursor-pointer"
            value={currentRunId && runHistory.some((e) => e.run_id === currentRunId) ? currentRunId : ""}
            disabled={disabled}
            onChange={(e) => {
              const runId = e.target.value;
              if (runId) onSelectRun(runId);
            }}
          >
            <option value="">Load a previous run…</option>
            {runHistory.map((entry) => {
              const label = entry.project_name || entry.run_id;
              return (
                <option key={entry.run_id} value={entry.run_id}>
                  {entry.parent_run_id ? `↳ ${label} (revision) — ${entry.run_id}` : `${label} — ${entry.run_id}`}
                </option>
              );
            })}
          </select>
          <input
            type="text"
            aria-label="Run ID to load"
            placeholder="Run ID (e.g. from adk chat)"
            className="field-input w-56"
            value={runIdInput}
            disabled={disabled}
            onChange={(e) => setRunIdInput(e.target.value)}
            // Some browser extensions (form-fill/security tools) stamp island_* attributes onto
            // text inputs before React hydrates — a real DOM difference, but not one we cause.
            suppressHydrationWarning
          />
          <button
            type="button"
            className="btn btn-secondary"
            disabled={disabled}
            onClick={() => {
              const runId = runIdInput.trim();
              if (!runId) return;
              onLoadRunId(runId);
              setRunIdInput("");
            }}
          >
            Load run
          </button>
          {showNewRequest && (
            <button type="button" className="btn btn-secondary" disabled={disabled} onClick={onNewRequest}>
              New Request
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
