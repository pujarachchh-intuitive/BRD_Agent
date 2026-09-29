"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, DollarSign, FileStack, FilePlus2, Files, History, Layers, Sparkles } from "lucide-react";
import TopBar from "@/components/layout/TopBar";
import ErrorBanner from "@/components/ErrorBanner";
import RunCard from "@/components/RunCard";
import CostByAgentChart from "@/components/dashboard/CostByAgentChart";
import CostOverTimeChart from "@/components/dashboard/CostOverTimeChart";
import ConsistencyMeter from "@/components/dashboard/ConsistencyMeter";
import RunsPerDayChart from "@/components/dashboard/RunsPerDayChart";
import { apiListRuns } from "@/lib/api";
import {
  AgentCost,
  ConsistencyStats,
  DashboardStats,
  DayCount,
  DayValue,
  computeConsistencyStats,
  computeCostByAgent,
  computeCostOverTime,
  computeDashboardStats,
  computeRunsPerDay,
  formatCost,
  formatDuration,
} from "@/lib/dashboardStats";
import { BackendRunSummary } from "@/lib/types";

interface DashboardData {
  stats: DashboardStats;
  runsPerDay: DayCount[];
  costOverTime: DayValue[];
  costByAgent: AgentCost[];
  consistency: ConsistencyStats;
}

export default function DashboardPage() {
  const [runs, setRuns] = useState<BackendRunSummary[] | null>(null);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiListRuns()
      .then((data) => {
        if (cancelled) return;
        setRuns(data);
        // Computed once here (not during render) — Date.now() is impure, and a component's render
        // body must stay a pure function of props/state.
        const now = Date.now();
        setDashboardData({
          stats: computeDashboardStats(data, now),
          runsPerDay: computeRunsPerDay(data, now),
          costOverTime: computeCostOverTime(data, now),
          costByAgent: computeCostByAgent(data),
          consistency: computeConsistencyStats(data),
        });
      })
      .catch((err) => {
        if (!cancelled) setErrorMessage(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = dashboardData?.stats;

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
              <Clock size={17} />
            </div>
            <div className="stat-tile-value">
              {!stats ? (
                <span className="skeleton inline-block h-8 w-12 align-middle" />
              ) : stats.avgDurationSeconds != null ? (
                formatDuration(stats.avgDurationSeconds)
              ) : (
                <span className="text-xl" style={{ color: "var(--color-text-muted)" }}>
                  —
                </span>
              )}
            </div>
            <div className="stat-tile-label">Avg generation time</div>
          </div>
          <div className="stat-tile">
            <div className="stat-tile-icon">
              <DollarSign size={17} />
            </div>
            <div className="stat-tile-value">
              {!stats ? (
                <span className="skeleton inline-block h-8 w-12 align-middle" />
              ) : stats.totalCostUsd != null ? (
                formatCost(stats.totalCostUsd)
              ) : (
                <span className="text-xl" style={{ color: "var(--color-text-muted)" }}>
                  —
                </span>
              )}
            </div>
            <div className="stat-tile-label">Total est. AI cost</div>
          </div>
          <div className="stat-tile">
            <div className="stat-tile-icon">
              <Layers size={17} />
            </div>
            <div className="stat-tile-value">{stats ? stats.uniqueProjects : <span className="skeleton inline-block h-8 w-12 align-middle" />}</div>
            <div className="stat-tile-label">Unique projects</div>
          </div>
          <div className="stat-tile">
            <div className="stat-tile-icon">
              <Files size={17} />
            </div>
            <div className="stat-tile-value">
              {stats ? stats.documentsGenerated : <span className="skeleton inline-block h-8 w-12 align-middle" />}
            </div>
            <div className="stat-tile-label">Documents generated</div>
          </div>
          <div className="stat-tile">
            <div className="stat-tile-icon">
              <CheckCircle2 size={17} />
            </div>
            <div className="stat-tile-value">
              {!dashboardData ? (
                <span className="skeleton inline-block h-8 w-12 align-middle" />
              ) : dashboardData.consistency.rate != null ? (
                `${Math.round(dashboardData.consistency.rate * 100)}%`
              ) : (
                <span className="text-xl" style={{ color: "var(--color-text-muted)" }}>
                  —
                </span>
              )}
            </div>
            <div className="stat-tile-label">Consistency pass rate</div>
          </div>
        </div>

        <div className="section-heading">
          <h2>Activity</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="card p-5">
            <h3 className="mb-1 text-sm font-semibold" style={{ color: "var(--color-text)" }}>
              Runs per day
            </h3>
            <p className="mb-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
              Last 14 days
            </p>
            {dashboardData ? (
              <RunsPerDayChart data={dashboardData.runsPerDay} />
            ) : (
              <div className="skeleton" style={{ height: 180 }} />
            )}
          </div>
          <div className="card p-5">
            <h3 className="mb-1 text-sm font-semibold" style={{ color: "var(--color-text)" }}>
              Estimated cost by agent
            </h3>
            <p className="mb-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
              Where generation spend goes, across all logged runs
            </p>
            {!dashboardData ? (
              <div className="skeleton" style={{ height: 180 }} />
            ) : dashboardData.costByAgent.length > 0 ? (
              <CostByAgentChart data={dashboardData.costByAgent} />
            ) : (
              <p className="py-10 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
                No cost data yet — this appears once a run has been generated with usage logging enabled.
              </p>
            )}
          </div>
          <div className="card p-5">
            <h3 className="mb-1 text-sm font-semibold" style={{ color: "var(--color-text)" }}>
              Estimated cost per day
            </h3>
            <p className="mb-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
              Last 14 days
            </p>
            {dashboardData ? <CostOverTimeChart data={dashboardData.costOverTime} /> : <div className="skeleton" style={{ height: 180 }} />}
          </div>
          <div className="card p-5">
            <h3 className="mb-1 text-sm font-semibold" style={{ color: "var(--color-text)" }}>
              Consistency check pass rate
            </h3>
            <p className="mb-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
              Cross-document contradiction check, every run
            </p>
            {dashboardData ? <ConsistencyMeter stats={dashboardData.consistency} /> : <div className="skeleton" style={{ height: 60 }} />}
          </div>
        </div>

        <div className="section-heading">
          <h2>Recent runs</h2>
          {runs && runs.length > 0 && (
            <Link href="/history" className="btn btn-ghost btn-small">
              View all history <History size={14} />
            </Link>
          )}
        </div>

        {!runs ? (
          <div className="run-list">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton" style={{ height: 62 }} />
            ))}
          </div>
        ) : runs.length > 0 ? (
          <div className="run-list">
            {runs.slice(0, 6).map((run) => (
              <RunCard key={run.run_id} run={run} />
            ))}
          </div>
        ) : (
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
        )}
      </div>
    </>
  );
}
