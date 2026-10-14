import mermaid from "mermaid";

let initialized = false;

// Satoshi is the company font (served from /fonts, see globals.css); the rest is mermaid's own
// default stack, used if the font files aren't there.
const DIAGRAM_FONT_FAMILY = '"Satoshi", "trebuchet ms", verdana, arial, sans-serif';

/** Ported 1:1 from webapp/static/app.js's DOMContentLoaded mermaid.initialize call. Idempotent —
 * safe to call from every component that renders diagrams. */
export function ensureMermaidInitialized(): void {
  if (initialized) return;
  initialized = true;
  mermaid.initialize({
    startOnLoad: false,
    theme: "default",
    fontFamily: DIAGRAM_FONT_FAMILY,
    themeVariables: { fontFamily: DIAGRAM_FONT_FAMILY },
    // Default securityLevel ("strict") forces plain, non-wrapping SVG <text> labels, which is why
    // long node labels (e.g. "Conduct Discovery & Questions") were getting clipped at the node's
    // right edge instead of wrapping onto a second line. "loose" allows htmlLabels, which renders
    // labels as wrapped HTML inside a foreignObject sized to fit the wrapped text.
    securityLevel: "loose",
    flowchart: {
      htmlLabels: true,
      useMaxWidth: true,
      wrappingWidth: 180,
      // Mermaid's defaults are 50/50. A little tighter keeps large flows to fewer printed pages
      // (see diagramLayout.ts) without crowding labels.
      nodeSpacing: 40,
      rankSpacing: 40,
      // Mermaid pads every label to at least 120px wide, which turns a one-letter off-page
      // connector circle (diagramLayout.ts / flowchartPages.ts) into a ~190px disc and wastes
      // page height. Labels longer than a few characters are unaffected.
      minNodeWidth: 24,
    },
  });
}

let fontsReady: Promise<void> | null = null;

/** Mermaid measures label text as it lays a diagram out, so the font has to be loaded first or
 * boxes get sized for the fallback font. Resolves (never rejects) once Satoshi is ready or known
 * to be unavailable. */
export function ensureDiagramFontsLoaded(): Promise<void> {
  if (!fontsReady) {
    fontsReady =
      typeof document === "undefined" || !document.fonts
        ? Promise.resolve()
        : Promise.all([document.fonts.load('16px "Satoshi"'), document.fonts.load('bold 16px "Satoshi"')])
            .then(() => undefined)
            .catch(() => undefined);
  }
  return fontsReady;
}

export { mermaid };
