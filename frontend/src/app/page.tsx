"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileStack, FilePlus2, FolderOpen, Layers, Search, Sparkles } from "lucide-react";
import TopBar from "@/components/layout/TopBar";
import ErrorBanner from "@/components/ErrorBanner";
import { apiListRuns } from "@/lib/api";
import { BackendRunSummary } from "@/lib/types";
import { formatRelativeTime, parseRunTimestamp } from "@/lib/runId";

interface DashboardStats {
  total: number;
  thisWeek: number;
  uniqueProjects: number;
}

export default function DashboardPage() {
  const [runs, setRuns] = useState<BackendRunSummary[] | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiListRuns()
      .then((data) => {
        if (cancelled) return;
        setRuns(data);
        // "This week" is computed once here (not during render) — Date.now() is impure, and a
        // component's render body must stay a pure function of props/state.
        const now = Date.now();
        const thisWeek = data.filter((r) => {
          const ts = parseRunTimestamp(r.run_id);
          return ts && now - ts.getTime() < 7 * 24 * 60 * 60 * 1000;
        }).length;
        const uniqueProjects = new Set(data.map((r) => r.project_name || r.run_id)).size;
        setStats({ total: data.length, thisWeek, uniqueProjects });
      })
      .catch((err) => {
        if (!cancelled) setErrorMessage(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredRuns = runs?.filter((r) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (r.project_name || "").toLowerCase().includes(q) || r.run_id.toLowerCase().includes(q);
  });

  return (
    <>
      <TopBar title="Dashboard" />
      <div className="app-content">
        <ErrorBanner message={errorMessage} />

        <section className="hero-panel">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div className="max-w-xl">
              <h1 className="text-2xl font-bold">Turn a project idea into a full document set</h1>
              <p className="mt-2 text-sm opacity-90">
                Describe what you&apos;re building and generate a BRD, TSD, flowchart, architecture diagram, and
                executive one-pager — consistency-checked, in minutes.
              </p>
            </div>
            <Link href="/new" className="btn btn-primary btn-large">
              <FilePlus2 size={18} /> New Request
            </Link>
          </div>
        </section>

        <div className="stat-grid mt-6">
          <div className="stat-tile">
            <div className="stat-tile-icon">
              <FileStack size={17} />
            </div>
            <div className="stat-tile-value">{stats ? stats.total : <span className="skeleton inline-block h-8 w-12 align-middle" />}</div>
            <div className="stat-tile-label">Total runs</div>
          </div>
          <div className="stat-tile">
            <div className="stat-tile-icon">
              <Sparkles size={17} />
            </div>
            <div className="stat-tile-value">{stats ? stats.thisWeek : <span className="skeleton inline-block h-8 w-12 align-middle" />}</div>
            <div className="stat-tile-label">Generated this week</div>
          </div>
          <div className="stat-tile">
            <div className="stat-tile-icon">
              <Layers size={17} />
            </div>
            <div className="stat-tile-value">{stats ? stats.uniqueProjects : <span className="skeleton inline-block h-8 w-12 align-middle" />}</div>
            <div className="stat-tile-label">Unique projects</div>
          </div>
        </div>

        <div className="section-heading">
          <h2>Recent runs</h2>
          {runs && runs.length > 0 && (
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" style={{ color: "var(--color-text-muted)" }} />
              <input
                type="text"
                className="field-input py-1.5 pl-8 text-sm"
                style={{ width: 220 }}
                placeholder="Search runs..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}
        </div>

        {!runs ? (
          <div className="run-list">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton" style={{ height: 62 }} />
            ))}
          </div>
        ) : filteredRuns && filteredRuns.length > 0 ? (
          <div className="run-list">
            {filteredRuns.map((run) => {
              const ts = parseRunTimestamp(run.run_id);
              return (
                <Link key={run.run_id} href={`/runs/${run.run_id}`} className="run-card">
                  <div className="run-card-main">
                    <div className="run-card-icon">
                      <FolderOpen size={17} />
                    </div>
                    <div className="min-w-0">
                      <div className="run-card-title">{run.project_name || run.run_id}</div>
                      <div className="run-card-meta">{run.run_id}</div>
                    </div>
                  </div>
                  <span className="chip chip-neutral whitespace-nowrap">{formatRelativeTime(ts)}</span>
                </Link>
              );
            })}
          </div>
        ) : runs.length === 0 ? (
          <div className="card empty-state">
            <div className="empty-state-icon">
              <Sparkles size={22} />
            </div>
            <p className="mb-4 font-medium" style={{ color: "var(--color-text)" }}>
              No runs yet — generate your first document set to see it here.
            </p>
            <Link href="/new" className="btn btn-primary">
              <FilePlus2 size={16} /> New Request
            </Link>
          </div>
        ) : (
          <div className="card empty-state">
            <p>No runs match &quot;{query}&quot;.</p>
          </div>
        )}
      </div>
    </>
  );
}
