import mermaid from "mermaid";

let initialized = false;

/** Ported 1:1 from webapp/static/app.js's DOMContentLoaded mermaid.initialize call. Idempotent —
 * safe to call from every component that renders diagrams. */
export function ensureMermaidInitialized(): void {
  if (initialized) return;
  initialized = true;
  mermaid.initialize({
    startOnLoad: false,
    theme: "default",
    // Default securityLevel ("strict") forces plain, non-wrapping SVG <text> labels, which is why
    // long node labels (e.g. "Conduct Discovery & Questions") were getting clipped at the node's
    // right edge instead of wrapping onto a second line. "loose" allows htmlLabels, which renders
    // labels as wrapped HTML inside a foreignObject sized to fit the wrapped text.
    securityLevel: "loose",
    flowchart: {
      htmlLabels: true,
      useMaxWidth: true,
      wrappingWidth: 180,
    },
  });
}

export { mermaid };
