"use client";

import { useEffect, useRef } from "react";
import { DocumentRenderer } from "@/lib/documentRenderer";
import { RunResult } from "@/lib/types";
import AssumptionsPanel from "./AssumptionsPanel";
import ConsistencyPanel from "./ConsistencyPanel";
import RevisePanel from "./RevisePanel";
import RunBadge from "./RunBadge";

// Fixed nav order, matching the original static HTML — independent of the order documents/diagram
// panels happen to be built in.
const NAV_TABS = [
  { key: "brd", title: "BRD" },
  { key: "tsd", title: "TSD" },
  { key: "flowchart", title: "Flowchart" },
  { key: "architecture", title: "Architecture" },
  { key: "onepager", title: "One-Pager" },
];

interface ResultsViewProps {
  data: RunResult;
  disabled: boolean;
  onError: (message: string) => void;
  onRevise: (changeRequest: string) => Promise<boolean>;
}

export default function ResultsView({ data, disabled, onError, onRevise }: ResultsViewProps) {
  const tabsNavRef = useRef<HTMLDivElement>(null);
  const panelsRef = useRef<HTMLDivElement>(null);
  const printRootRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<DocumentRenderer | null>(null);
  const currentRunIdRef = useRef<string | null>(null);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    currentRunIdRef.current = data.run_id;
  }, [data.run_id]);

  // The renderer is created once and reused across every run: it owns the tab-panels DOM directly
  // (mermaid needs real, laid-out nodes, and rendered <svg> nodes are cached for later PNG/DOCX
  // export), so re-creating it per run would throw away that cache for no reason.
  useEffect(() => {
    if (!tabsNavRef.current || !panelsRef.current || !printRootRef.current) return;
    const renderer = new DocumentRenderer({
      tabsNavEl: tabsNavRef.current,
      panelsContainerEl: panelsRef.current,
      printRootEl: printRootRef.current,
      onError: (message) => onErrorRef.current(message),
      getCurrentRunId: () => currentRunIdRef.current,
    });
    rendererRef.current = renderer;
    return () => {
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.renderResults(data);
  }, [data]);

  return (
    <section id="results-section">
      <RunBadge data={data} />
      <AssumptionsPanel reqJson={data.requirements_json} />
      <ConsistencyPanel reportMd={data.consistency_report} />

      <div className="sticky z-10 py-1" style={{ top: "64px", background: "var(--color-bg)" }}>
        <nav className="tabs" id="doc-tabs" ref={tabsNavRef}>
          {NAV_TABS.map((tab) => (
            // className is intentionally static — DocumentRenderer.switchTab owns the "active"
            // class via direct DOM manipulation; if this were computed from React state, every
            // unrelated re-render of ResultsView would stomp on that.
            <button key={tab.key} type="button" className="tab-btn" data-tab={tab.key}>
              {tab.title}
            </button>
          ))}
        </nav>
      </div>

      <div className="tab-panels mb-5" ref={panelsRef} />

      <RevisePanel disabled={disabled} onApply={onRevise} />

      <div id="print-root" className="print-root" ref={printRootRef} />
    </section>
  );
}
