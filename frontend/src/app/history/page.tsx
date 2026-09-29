"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FilePlus2, History, Search } from "lucide-react";
import TopBar from "@/components/layout/TopBar";
import ErrorBanner from "@/components/ErrorBanner";
import RunCard from "@/components/RunCard";
import { apiListRuns } from "@/lib/api";
import { RunTreeNode, buildRunTree, countTreeNodes } from "@/lib/runTree";
import { BackendRunSummary } from "@/lib/types";

function nodeMatches(node: RunTreeNode, query: string): boolean {
  const self = `${node.run.project_name ?? ""} ${node.run.run_id}`.toLowerCase();
  return self.includes(query) || node.children.some((child) => nodeMatches(child, query));
}

function RunTreeItem({ node, depth }: { node: RunTreeNode; depth: number }) {
  return (
    <div className="flex flex-col gap-2">
      <RunCard run={node.run} isRevision={depth > 0} />
      {node.children.length > 0 && (
        <div className="ml-5 flex flex-col gap-2 border-l pl-4" style={{ borderColor: "var(--color-border)" }}>
          {node.children.map((child) => (
            <RunTreeItem key={child.run.run_id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function HistoryPage() {
  const [runs, setRuns] = useState<BackendRunSummary[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiListRuns()
      .then((data) => {
        if (!cancelled) setRuns(data);
      })
      .catch((err) => {
        if (!cancelled) setErrorMessage(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const tree = runs ? buildRunTree(runs) : null;
  const q = query.trim().toLowerCase();
  // Keep a root's whole family if the root OR any of its revisions match — searching for a
  // revision's change should still surface the original request it belongs to, as context.
  const visibleTree = tree ? (q ? tree.filter((node) => nodeMatches(node, q)) : tree) : null;

  return (
    <>
      <TopBar title="History" />
      <div className="app-content">
        <ErrorBanner message={errorMessage} />

        <div className="section-heading" style={{ marginTop: 0 }}>
          <h2>All runs</h2>
          {runs && runs.length > 0 && (
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" style={{ color: "var(--color-text-muted)" }} />
              <input
                type="text"
                className="field-input py-1.5 pl-8 text-sm"
                style={{ width: 240 }}
                placeholder="Search history..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}
        </div>
        <p className="mb-4 text-xs" style={{ color: "var(--color-text-muted)" }}>
          Every run ever generated, from this app or from <code>adk web</code>/<code>adk run</code> directly. A
          &quot;request a change&quot; revision is nested under the run it revised.
        </p>

        {!visibleTree ? (
          <div className="run-list">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton" style={{ height: 62 }} />
            ))}
          </div>
        ) : visibleTree.length > 0 ? (
          <div className="run-list">
            {visibleTree.map((node) => (
              <RunTreeItem key={node.run.run_id} node={node} depth={0} />
            ))}
          </div>
        ) : runs && runs.length > 0 ? (
          <div className="card empty-state">
            <p>No runs match &quot;{query}&quot;.</p>
          </div>
        ) : (
          <div className="card empty-state">
            <div className="empty-state-icon">
              <History size={22} />
            </div>
            <p className="mb-4 font-medium" style={{ color: "var(--color-text)" }}>
              No runs yet — generate your first document set to see it here.
            </p>
            <Link href="/new" className="btn btn-primary">
              <FilePlus2 size={16} /> New Request
            </Link>
          </div>
        )}

        {visibleTree && visibleTree.length > 0 && runs && (
          <p className="mt-4 text-center text-xs" style={{ color: "var(--color-text-muted)" }}>
            {countTreeNodes(visibleTree)} of {runs.length} run{runs.length === 1 ? "" : "s"} shown
          </p>
        )}
      </div>
    </>
  );
}
