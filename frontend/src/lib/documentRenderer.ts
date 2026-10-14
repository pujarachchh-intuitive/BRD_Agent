// Everything about showing the 5 generated documents: tabs, Markdown -> HTML rendering (with live
// mermaid diagrams substituted in for the `architecture.png` / `flowchart.png` image placeholders),
// the client-side SVG -> PNG pipeline, DOCX export, and the print/PDF view.
//
// Ported from webapp/static/documents.js as an imperative renderer (rather than reactive React
// state) because mermaid needs real, laid-out DOM nodes to measure and wrap text into, and the
// rendered diagrams are measured and reused later for PNG/DOCX export and printing — trying to
// model that as React state would mean re-deriving DOM nodes from state, which is exactly
// backwards here.

import { marked } from "marked";
import { apiExportDocx, apiUploadDiagrams, ExportDiagramPart } from "./api";
import {
  DiagramPagePart,
  layoutDiagramForPages,
  prepareDiagram,
  PreparedDiagram,
  rasterizeWholeDiagram,
} from "./diagramLayout";
import { wrapMermaidLabels } from "./mermaidLabels";
import { ensureDiagramFontsLoaded, ensureMermaidInitialized, mermaid } from "./mermaidSetup";
import { triggerDownload } from "./svgToPng";
import { DiagramKey, RunResult } from "./types";

interface DocTabConfig {
  key: "brd" | "tsd" | "onepager";
  title: string;
  exportDoc: string;
  filename: string;
  diagrams: DiagramKey[];
}

interface DiagramTabConfig {
  key: DiagramKey;
  title: string;
}

const DOC_TAB_CONFIG: DocTabConfig[] = [
  { key: "brd", title: "BRD", exportDoc: "brd", filename: "BRD.docx", diagrams: ["flowchart", "architecture"] },
  { key: "tsd", title: "TSD", exportDoc: "tsd", filename: "TSD.docx", diagrams: ["architecture", "flowchart"] },
  { key: "onepager", title: "Executive One-Pager", exportDoc: "onepager", filename: "Executive_OnePager.docx", diagrams: ["architecture"] },
];
const DIAGRAM_TAB_CONFIG: DiagramTabConfig[] = [
  { key: "flowchart", title: "Flowchart" },
  { key: "architecture", title: "Architecture" },
];

export const ALL_TAB_KEYS = [...DOC_TAB_CONFIG.map((c) => c.key), ...DIAGRAM_TAB_CONFIG.map((c) => c.key)];

let mermaidUidCounter = 0;
function nextMermaidId(prefix: string): string {
  mermaidUidCounter += 1;
  return `${prefix}-${Date.now()}-${mermaidUidCounter}`;
}

interface MermaidNode {
  key: DiagramKey;
  el: HTMLElement;
}

/** Parses `mdText` to HTML and swaps any `![...](architecture.png)` / `![...](flowchart.png)`
 * image reference for a live mermaid container (those files only exist on disk after a DOCX
 * export uploads them, so the <img> src would otherwise 404 / show a broken image icon). */
function buildMarkdownContent(mdText: string | null, mermaidSrcs: Record<DiagramKey, string>): { element: HTMLDivElement; mermaidNodes: MermaidNode[] } {
  const wrapper = document.createElement("div");
  wrapper.className = "markdown-body prose prose-slate";
  wrapper.innerHTML = marked.parse(mdText || "*(not available)*", { async: false }) as string;

  const mermaidNodes: MermaidNode[] = [];
  const imgs = Array.from(wrapper.querySelectorAll("img"));
  imgs.forEach((img) => {
    const src = img.getAttribute("src") || "";
    let key: DiagramKey | null = null;
    if (/architecture\.png$/i.test(src)) key = "architecture";
    else if (/flowchart\.png$/i.test(src)) key = "flowchart";

    if (key && mermaidSrcs[key]) {
      const figure = document.createElement("figure");
      figure.className = "inline-diagram not-prose";
      figure.dataset.diagram = key;
      const pre = document.createElement("pre");
      pre.className = "mermaid";
      pre.id = nextMermaidId(`mermaid-${key}`);
      pre.textContent = mermaidSrcs[key];
      figure.appendChild(pre);
      const caption = document.createElement("figcaption");
      caption.textContent = img.getAttribute("alt") || key;
      figure.appendChild(caption);
      img.replaceWith(figure);
      mermaidNodes.push({ key, el: pre });
    } else {
      img.replaceWith(document.createComment(`diagram placeholder omitted: ${src}`));
    }
  });

  return { element: wrapper, mermaidNodes };
}

export interface DocumentRendererOptions {
  tabsNavEl: HTMLElement;
  panelsContainerEl: HTMLElement;
  printRootEl: HTMLElement;
  onError: (message: string) => void;
  getCurrentRunId: () => string | null;
}

export class DocumentRenderer {
  private opts: DocumentRendererOptions;
  private tabPanels: Record<string, HTMLDivElement> = {};
  private prepared: Partial<Record<DiagramKey, PreparedDiagram>> = {};
  private pageParts: Partial<Record<DiagramKey, Promise<DiagramPagePart[]>>> = {};
  private activeTab = "brd";
  private navClickHandler: (event: MouseEvent) => void;

  constructor(opts: DocumentRendererOptions) {
    this.opts = opts;
    ensureMermaidInitialized();
    this.navClickHandler = (event: MouseEvent) => {
      const btn = (event.target as HTMLElement).closest<HTMLElement>(".tab-btn");
      if (!btn || !btn.dataset.tab) return;
      this.switchTab(btn.dataset.tab);
    };
    this.opts.tabsNavEl.addEventListener("click", this.navClickHandler);
  }

  destroy(): void {
    this.opts.tabsNavEl.removeEventListener("click", this.navClickHandler);
  }

  async renderResults(data: RunResult): Promise<void> {
    const panelsContainer = this.opts.panelsContainerEl;

    // Guards against two renderResults calls racing on the same shared DOM — which otherwise
    // happens routinely in dev, since React's Strict Mode deliberately double-invokes effects, and
    // in principle in prod too if a user loads two runs in quick succession. The epoch is stamped
    // on the container itself (not on `this`) so it works across renderer instances, not just
    // within one: whichever call is newest wins, and any older call still mid-`await` notices it
    // has been superseded and stops touching the DOM instead of fighting the newer render for it.
    const myEpoch = (Number(panelsContainer.dataset.renderEpoch) || 0) + 1;
    panelsContainer.dataset.renderEpoch = String(myEpoch);
    const superseded = () => panelsContainer.dataset.renderEpoch !== String(myEpoch);

    panelsContainer.innerHTML = "";
    this.tabPanels = {};
    this.prepared = {};
    this.pageParts = {};

    // Each diagram is first laid out off-screen to pick the drawing direction that reads best on
    // an A4 portrait page (diagramLayout.ts); the preview then shows that same layout, so what's on
    // screen is what gets exported and printed.
    await ensureDiagramFontsLoaded();
    const mermaidSrcs: Record<DiagramKey, string> = {
      architecture: wrapMermaidLabels(data.documents.architecture_mermaid),
      flowchart: wrapMermaidLabels(data.documents.flowchart_mermaid),
    };
    for (const key of ["flowchart", "architecture"] as DiagramKey[]) {
      const prepared = mermaidSrcs[key] ? await prepareDiagram(mermaidSrcs[key]) : null;
      if (superseded()) return;
      if (prepared) {
        this.prepared[key] = prepared;
        mermaidSrcs[key] = prepared.source;
      }
    }

    for (const cfg of DOC_TAB_CONFIG) {
      if (superseded()) return;
      const panel = document.createElement("div");
      panel.className = "tab-panel";
      panel.dataset.tab = cfg.key;
      panel.appendChild(this.buildDocToolbar(cfg));
      const scroll = document.createElement("div");
      scroll.className = "doc-scroll";
      panel.appendChild(scroll);
      panelsContainer.appendChild(panel);
      this.tabPanels[cfg.key] = panel;

      // Mermaid needs the element to have real, visible layout to measure text correctly, so we
      // briefly make this panel "active" (in-flow, visible) while its diagrams render.
      panel.classList.add("active");
      const mdText = data.documents[`${cfg.key}_markdown` as const];
      const { element, mermaidNodes } = buildMarkdownContent(mdText, mermaidSrcs);
      scroll.appendChild(element);
      for (const node of mermaidNodes) {
        try {
          await mermaid.run({ nodes: [node.el] });
          if (superseded()) return;
        } catch (err) {
          if (!superseded()) console.error(`Failed to render inline ${node.key} diagram`, err);
        }
      }
      if (superseded()) return;
      panel.classList.remove("active");
    }

    for (const cfg of DIAGRAM_TAB_CONFIG) {
      if (superseded()) return;
      const panel = document.createElement("div");
      panel.className = "tab-panel";
      panel.dataset.tab = cfg.key;
      panel.appendChild(this.buildDiagramToolbar(cfg));
      const holder = document.createElement("div");
      holder.className = "diagram-holder";
      const src = mermaidSrcs[cfg.key];
      if (src) {
        const pre = document.createElement("pre");
        pre.className = "mermaid";
        pre.id = nextMermaidId(`mermaid-tab-${cfg.key}`);
        pre.textContent = src;
        holder.appendChild(pre);
        panel.appendChild(holder);
        panelsContainer.appendChild(panel);
        this.tabPanels[cfg.key] = panel;

        panel.classList.add("active");
        try {
          await mermaid.run({ nodes: [pre] });
          if (superseded()) return;
        } catch (err) {
          if (superseded()) return;
          console.error(`Failed to render ${cfg.key} diagram`, err);
          holder.innerHTML = '<p class="doc-empty">This diagram failed to render.</p>';
        }
        panel.classList.remove("active");
      } else {
        holder.innerHTML = '<p class="doc-empty">No diagram available for this run.</p>';
        panel.appendChild(holder);
        panelsContainer.appendChild(panel);
        this.tabPanels[cfg.key] = panel;
      }
    }

    if (superseded()) return;
    this.switchTab(this.activeTab && this.tabPanels[this.activeTab] ? this.activeTab : "brd");
  }

  switchTab(tabKey: string): void {
    this.activeTab = tabKey;
    this.opts.tabsNavEl.querySelectorAll<HTMLElement>(".tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tabKey);
    });
    Object.entries(this.tabPanels).forEach(([key, panel]) => {
      panel.classList.toggle("active", key === tabKey);
    });
  }

  private buildDocToolbar(cfg: DocTabConfig): HTMLDivElement {
    const bar = document.createElement("div");
    bar.className = "doc-toolbar";

    const downloadBtn = document.createElement("button");
    downloadBtn.type = "button";
    downloadBtn.className = "btn btn-secondary";
    downloadBtn.textContent = "Download DOCX";
    downloadBtn.addEventListener("click", () => this.exportDocDocx(cfg, downloadBtn));
    bar.appendChild(downloadBtn);

    const printBtn = document.createElement("button");
    printBtn.type = "button";
    printBtn.className = "btn btn-secondary";
    printBtn.textContent = "Print / Save as PDF";
    printBtn.addEventListener("click", () => this.printDocument(cfg, printBtn));
    bar.appendChild(printBtn);

    return bar;
  }

  private buildDiagramToolbar(cfg: DiagramTabConfig): HTMLDivElement {
    const bar = document.createElement("div");
    bar.className = "doc-toolbar";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary";
    btn.textContent = "Download PNG";
    btn.addEventListener("click", () => this.downloadDiagramPng(cfg.key, btn));
    bar.appendChild(btn);
    return bar;
  }

  /** The diagram split into A4-portrait-page-sized images (computed once per run, then reused by
   * every export and print). */
  private getPageParts(key: DiagramKey): Promise<DiagramPagePart[]> | null {
    const prepared = this.prepared[key];
    if (!prepared) return null;
    if (!this.pageParts[key]) {
      this.pageParts[key] = layoutDiagramForPages(prepared).catch((err) => {
        delete this.pageParts[key];
        throw err;
      });
    }
    return this.pageParts[key];
  }

  private async downloadDiagramPng(key: DiagramKey, btn: HTMLButtonElement): Promise<void> {
    const prepared = this.prepared[key];
    if (!prepared) {
      this.opts.onError(`No ${key} diagram is available to download for this run.`);
      return;
    }
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Preparing...";
    try {
      const dataUrl = await rasterizeWholeDiagram(prepared);
      triggerDownload(dataUrl, `${key}.png`);
    } catch (err) {
      this.opts.onError(err instanceof Error ? err.message : String(err));
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }

  private async exportDocDocx(cfg: DocTabConfig, btn: HTMLButtonElement): Promise<void> {
    const runId = this.opts.getCurrentRunId();
    if (!runId) {
      this.opts.onError("No active run to export.");
      return;
    }
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Exporting...";
    try {
      // The full-size PNGs are still uploaded (they're kept with the run in Databricks); the
      // document itself uses the page-sized parts sent with the export request.
      const payload: Record<string, string> = {};
      const diagramParts: Partial<Record<DiagramKey, ExportDiagramPart[]>> = {};
      for (const key of cfg.diagrams) {
        const prepared = this.prepared[key];
        if (!prepared) continue;
        payload[key] = await rasterizeWholeDiagram(prepared);
        const parts = await this.getPageParts(key);
        if (parts) {
          diagramParts[key] = parts.map((p) => ({ png: p.dataUrl, width_pt: p.widthPt, height_pt: p.heightPt, label: p.label }));
        }
      }
      if (Object.keys(payload).length) {
        await apiUploadDiagrams(runId, payload);
      }
      const blob = await apiExportDocx(runId, cfg.exportDoc, diagramParts);
      const blobUrl = URL.createObjectURL(blob);
      triggerDownload(blobUrl, cfg.filename);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
    } catch (err) {
      this.opts.onError(err instanceof Error ? err.message : String(err));
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }

  /** Prints in the same layout as the DOCX: A4 portrait, logo in the header of every page (the
   * repeating <thead> below), page number bottom right (globals.css @page), and each diagram as
   * the same page-sized parts the DOCX export uses. */
  private async printDocument(cfg: DocTabConfig, btn: HTMLButtonElement): Promise<void> {
    const panel = this.tabPanels[cfg.key];
    const content = panel && panel.querySelector(".doc-scroll");
    if (!content) {
      this.opts.onError("Nothing to print yet.");
      return;
    }
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Preparing...";
    try {
      const body = content.cloneNode(true) as HTMLElement;
      for (const figure of Array.from(body.querySelectorAll<HTMLElement>("figure.inline-diagram[data-diagram]"))) {
        const parts = await this.getPageParts(figure.dataset.diagram as DiagramKey);
        if (!parts || !parts.length) continue;
        const caption = figure.querySelector("figcaption")?.textContent || "";
        const replacement = document.createDocumentFragment();
        for (const part of parts) {
          const partFigure = document.createElement("figure");
          partFigure.className = "print-diagram not-prose";
          const img = document.createElement("img");
          img.src = part.dataUrl;
          img.alt = caption;
          img.style.width = `${part.widthPt}pt`;
          img.style.height = `${part.heightPt}pt`;
          const partCaption = document.createElement("figcaption");
          partCaption.textContent = part.label ? `${caption} (${part.label})` : caption;
          partFigure.append(img, partCaption);
          replacement.appendChild(partFigure);
        }
        figure.replaceWith(replacement);
      }

      const printRoot = this.opts.printRootEl;
      printRoot.innerHTML = "";
      const table = document.createElement("table");
      table.className = "print-page";
      const logo = document.createElement("img");
      logo.src = "/brand/intuitive-logo.png";
      logo.alt = "Intuitive";
      logo.className = "print-logo";
      table.createTHead().insertRow().insertCell().appendChild(logo);
      table.createTBody().insertRow().insertCell().appendChild(body);
      printRoot.appendChild(table);

      await Promise.all(Array.from(printRoot.querySelectorAll("img")).map((img) => img.decode().catch(() => undefined)));
      window.print();
    } catch (err) {
      this.opts.onError(err instanceof Error ? err.message : String(err));
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }
}
