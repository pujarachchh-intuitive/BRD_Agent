// Fits mermaid diagrams onto A4 portrait pages for the DOCX export and the print view, without
// ever changing what the diagram says: every node, edge and label is kept exactly as generated.
//
// The only levers used are presentational:
//   1. Direction: a flowchart is laid out both top-down and left-right (the edges and nodes are
//      identical, only the drawing direction differs), and whichever reads better on a portrait
//      page wins. The same choice is used for the on-screen preview, so what you see is what exports.
//   2. Scale: shrink to the page width, but never below MIN_LABEL_PT for the label text.
//   3. Page breaks: a top-down flowchart that is still taller than a page is redrawn as one
//      flowchart per page, joined by lettered off-page connector circles (flowchartPages.ts). The
//      page budget is the A4 text area converted to mermaid pixels at the chosen scale; steps are
//      assigned to pages from their positions in the full layout, every page is rendered and
//      measured, and rows move to the next page until each one fits. Diagrams that can't be redrawn
//      exactly are instead cut into page-sized image slices, through empty space between rows
//      only (never through a box or a label). Either way each part is captioned "part i of n".
//      A diagram too wide to be readable at page width gets a whole-diagram overview, followed by
//      readable detail sections when those take only a few pages.
//
// Page geometry mirrors the reference doc (webapp/branding/build_reference_docx.py: A4, 1-inch
// margins) and MAX_DIAGRAM_HEIGHT_PT in webapp/branding/docx_export.py.

import { buildPages, CONNECTOR_ID, FlowPage, pagesPreserveFlowchart, parseFlowchart } from "./flowchartPages";
import { mermaid } from "./mermaidSetup";

export const TEXT_WIDTH_PT = 451;
// The text area is 698pt tall; this leaves room for the spacing above a diagram and its caption.
export const MAX_DIAGRAM_HEIGHT_PT = 640;

const PX_TO_PT = 0.75; // 1 CSS px = 0.75pt
const BASE_LABEL_PT = 16 * PX_TO_PT; // mermaid's 16px label font at 100%
const MIN_LABEL_PT = 9; // smallest label size we accept on paper (body text is 12pt)
const MIN_SCALE = MIN_LABEL_PT / BASE_LABEL_PT;
const MAX_SCALE = 1; // never enlarge: 100% already puts labels at body-text size
// Page cuts have to land in gaps between rows, so a page is never filled exactly — plan with slack.
const CUT_SLACK = 0.9;
// Keep cuts this far (px) away from any node or label.
const CUT_PADDING = 6;
// Output resolution: rasterize at this many device pixels per CSS px of the *printed* size...
const PRINT_PIXEL_RATIO = 3;
// ...but never below 2 pixels per diagram px, so a shrunk-down overview stays sharp when zoomed into.
const MIN_PIXELS_PER_UNIT = 2;
const MAX_CANVAS_SIDE = 16000;
// A diagram too wide to read at page width gets readable detail sections only if they fit in this
// many pages; beyond that the overview is shown on its own.
const MAX_DETAIL_PAGES = 4;

export type DiagramPartKind = "whole" | "part" | "overview" | "detail";

export interface DiagramPagePart {
  dataUrl: string;
  widthPt: number;
  heightPt: number;
  /** Caption suffix, e.g. "part 2 of 3"; empty when the diagram fits on one page. */
  label: string;
  kind: DiagramPartKind;
  /** Printed size of mermaid's label text, in points. */
  labelPt: number;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PreparedDiagram {
  /** The mermaid source to display everywhere (possibly with a different flowchart direction). */
  source: string;
  /** Well-formed SVG markup of the rendered diagram. */
  svgXml: string;
  viewBox: Box;
  /** Nodes, edge labels and subgraph titles, in viewBox coordinates — page cuts avoid these. */
  blocked: Box[];
  /** Flowchart node id -> its box, in viewBox coordinates (empty for other diagram types). */
  nodes: Record<string, Box>;
}

interface Region {
  box: Box;
  scale: number;
  label: string;
  kind: DiagramPartKind;
}

let renderCounter = 0;

const DIRECTION_SWAP: Record<string, string> = { TB: "LR", TD: "LR", BT: "RL", LR: "TB", RL: "BT" };
const FLOWCHART_HEADER = /^(\s*(?:flowchart|graph)\s+)(TB|TD|BT|LR|RL)\b/m;

function alternateDirection(source: string): string | null {
  const match = source.match(FLOWCHART_HEADER);
  if (!match) return null;
  return source.replace(FLOWCHART_HEADER, `$1${DIRECTION_SWAP[match[2]]}`);
}

const width = (b: Box) => b.x1 - b.x0;
const height = (b: Box) => b.y1 - b.y0;

/** Renders `source` off-screen and records its size and the boxes a page cut must avoid. */
async function measure(source: string): Promise<PreparedDiagram> {
  renderCounter += 1;
  const id = `diagram-layout-${Date.now()}-${renderCounter}`;
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  // Laid out (so getBBox/getScreenCTM work) but invisible and off-screen. The huge width lets the
  // SVG reach its natural size instead of shrinking to a container (mermaid sets max-width on it).
  host.style.cssText = "position:fixed;left:-30000px;top:0;width:20000px;visibility:hidden;pointer-events:none;";
  document.body.appendChild(host);
  try {
    const { svg } = await mermaid.render(id, source, host);
    host.innerHTML = svg;
    const svgEl = host.querySelector("svg");
    if (!svgEl) throw new Error("mermaid produced no SVG");
    const vb = svgEl.viewBox.baseVal;
    const viewBox: Box = { x0: vb.x, y0: vb.y, x1: vb.x + vb.width, y1: vb.y + vb.height };

    const rootCtm = svgEl.getScreenCTM();
    const blocked: Box[] = [];
    const nodes: Record<string, Box> = {};
    // Flowchart node groups are rendered with id "<render id>-flowchart-<node id>-<counter>".
    const nodeIdPrefix = `${id}-flowchart-`;
    if (rootCtm) {
      const toRoot = rootCtm.inverse();
      svgEl.querySelectorAll<SVGGraphicsElement>("g.node, g.edgeLabel, g.cluster-label").forEach((el) => {
        const bb = el.getBBox();
        const ctm = el.getScreenCTM();
        if (!bb.width || !bb.height || !ctm) return;
        const m = toRoot.multiply(ctm);
        const corners = [
          new DOMPoint(bb.x, bb.y),
          new DOMPoint(bb.x + bb.width, bb.y),
          new DOMPoint(bb.x, bb.y + bb.height),
          new DOMPoint(bb.x + bb.width, bb.y + bb.height),
        ].map((p) => p.matrixTransform(m));
        const box = {
          x0: Math.min(...corners.map((p) => p.x)),
          y0: Math.min(...corners.map((p) => p.y)),
          x1: Math.max(...corners.map((p) => p.x)),
          y1: Math.max(...corners.map((p) => p.y)),
        };
        blocked.push(box);
        if (el.classList.contains("node") && el.id.startsWith(nodeIdPrefix)) {
          nodes[el.id.slice(nodeIdPrefix.length).replace(/-\d+$/, "")] = box;
        }
      });
    }
    return { source, svgXml: new XMLSerializer().serializeToString(svgEl), viewBox, blocked, nodes };
  } finally {
    host.remove();
    document.getElementById(`d${id}`)?.remove(); // mermaid's temp node, if a parse error left it behind
  }
}

interface Fit {
  scale: number;
  readable: boolean;
  pages: number;
}

/** How a diagram of this size fits the page when only scaling/splitting vertically. */
function fitFor(box: Box): Fit {
  const wPt = width(box) * PX_TO_PT;
  const hPt = height(box) * PX_TO_PT;
  let scale = Math.min(MAX_SCALE, TEXT_WIDTH_PT / wPt);
  if (scale < MIN_SCALE) return { scale, readable: false, pages: Infinity };
  let pages = Math.ceil((hPt * scale) / (MAX_DIAGRAM_HEIGHT_PT * CUT_SLACK));
  // Shrinking a little (never below the readable minimum) is better than spilling onto one more page.
  for (let n = 1; n < pages; n++) {
    const s = (n * MAX_DIAGRAM_HEIGHT_PT * CUT_SLACK) / hPt;
    if (s >= MIN_SCALE) {
      scale = Math.min(scale, s);
      pages = n;
      break;
    }
  }
  return { scale, readable: true, pages };
}

function better(a: Fit, b: Fit): boolean {
  if (a.readable !== b.readable) return a.readable;
  if (!a.readable) return a.scale > b.scale;
  if (a.pages !== b.pages) return a.pages < b.pages;
  return a.scale > b.scale;
}

/** Renders the diagram in its own direction and (for flowcharts) the other one, and keeps
 * whichever fits an A4 portrait page better. Returns null if mermaid can't render it. */
export async function prepareDiagram(source: string): Promise<PreparedDiagram | null> {
  if (!source.trim()) return null;
  let best: PreparedDiagram;
  try {
    best = await measure(source);
  } catch (err) {
    console.error("Diagram failed to render", err);
    return null;
  }
  const alternate = alternateDirection(source);
  if (alternate) {
    try {
      const candidate = await measure(alternate);
      const [candidateFit, bestFit] = [fitFor(candidate.viewBox), fitFor(best.viewBox)];
      if (!candidateFit.readable && !bestFit.readable) {
        // Neither direction fits the page width readably. A top-down flowchart can still be
        // printed readably, page by page with connectors (paginateFlowchart), so prefer it.
        const vertical = [best, candidate].find((c) => /^(TB|TD|BT)$/.test(c.source.match(FLOWCHART_HEADER)?.[2] ?? ""));
        if (vertical && (await parseFlowchart(vertical.source))) best = vertical;
        else if (better(candidateFit, bestFit)) best = candidate;
      } else if (better(candidateFit, bestFit)) {
        best = candidate;
      }
    } catch {
      // keep the original direction
    }
  }
  return best;
}

/** Positions (in [lo, hi]) at which to cut a span into pieces no longer than maxLen, choosing
 * points outside every blocked interval and close to an even split. */
function chooseCuts(lo: number, hi: number, maxLen: number, blocked: [number, number][]): number[] {
  const intervals = blocked
    .map(([a, b]) => [a - CUT_PADDING, b + CUT_PADDING] as [number, number])
    .sort((p, q) => p[0] - q[0]);
  const merged: [number, number][] = [];
  for (const iv of intervals) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else merged.push([...iv]);
  }
  const isFree = (p: number) => !merged.some(([a, b]) => p > a && p < b);

  const cuts: number[] = [];
  let start = lo;
  while (hi - start > maxLen) {
    const remaining = Math.ceil((hi - start) / maxLen);
    const target = start + (hi - start) / remaining;
    const windowLo = start + maxLen * 0.3;
    const windowHi = start + maxLen;
    // Candidate cut points: the target itself, and the edges of every gap in the window.
    const candidates = [target, ...merged.flatMap(([a, b]) => [a, b])].filter(
      (p) => p >= windowLo && p <= windowHi && isFree(p)
    );
    let cut: number;
    if (candidates.length) {
      cut = candidates.reduce((bestP, p) => (Math.abs(p - target) < Math.abs(bestP - target) ? p : bestP));
    } else {
      cut = windowHi; // a single box taller than a page: nothing better is possible
    }
    cuts.push(cut);
    start = cut;
  }
  return cuts;
}

function spans(lo: number, hi: number, cuts: number[]): [number, number][] {
  const points = [lo, ...cuts, hi];
  return points.slice(1).map((p, i) => [points[i], p]);
}

function planRegions(d: PreparedDiagram): Region[] {
  const vb = d.viewBox;
  const fit = fitFor(vb);
  const pageH = (scale: number) => (MAX_DIAGRAM_HEIGHT_PT / PX_TO_PT / scale) * 0.999;
  const pageW = (scale: number) => (TEXT_WIDTH_PT / PX_TO_PT / scale) * 0.999;

  if (fit.readable) {
    const ySpans = spans(vb.y0, vb.y1, chooseCuts(vb.y0, vb.y1, pageH(fit.scale), d.blocked.map((b) => [b.y0, b.y1])));
    return ySpans.map(([y0, y1], i) => ({
      box: { x0: vb.x0, x1: vb.x1, y0, y1 },
      scale: fit.scale,
      label: ySpans.length > 1 ? `part ${i + 1} of ${ySpans.length}` : "",
      kind: ySpans.length > 1 ? "part" : "whole",
    }));
  }

  // Too wide to read at page width. First an overview of the whole thing, scaled to fit one page,
  // then — if it takes only a few pages — the diagram in readable sections: columns cut through
  // empty space, each split into rows. Past MAX_DETAIL_PAGES the sections would bury the document,
  // so the overview stands alone (rendered sharp enough to zoom into on screen).
  const overviewScale = Math.min(TEXT_WIDTH_PT / (width(vb) * PX_TO_PT), MAX_DIAGRAM_HEIGHT_PT / (height(vb) * PX_TO_PT));
  const overview: Region = { box: vb, scale: overviewScale, label: "", kind: "overview" };
  const columns = Math.ceil((width(vb) * PX_TO_PT * MIN_SCALE) / (TEXT_WIDTH_PT * CUT_SLACK));
  const scale = Math.min(MAX_SCALE, (columns * TEXT_WIDTH_PT * CUT_SLACK) / (width(vb) * PX_TO_PT));
  const xSpans = spans(vb.x0, vb.x1, chooseCuts(vb.x0, vb.x1, pageW(scale), d.blocked.map((b) => [b.x0, b.x1])));
  const details: Box[] = [];
  for (const [x0, x1] of xSpans) {
    const inColumn = d.blocked.filter((b) => b.x1 > x0 && b.x0 < x1);
    for (const [y0, y1] of spans(vb.y0, vb.y1, chooseCuts(vb.y0, vb.y1, pageH(scale), inColumn.map((b) => [b.y0, b.y1])))) {
      details.push({ x0, x1, y0, y1 });
    }
  }
  if (details.length > MAX_DETAIL_PAGES) return [overview];
  return [
    { ...overview, label: "overview, readable detail follows" },
    ...details.map((box, i) => ({ box, scale, label: `detail ${i + 1} of ${details.length}`, kind: "detail" as const })),
  ];
}

// --- Rasterizing ---------------------------------------------------------------------------------

let fontCssPromise: Promise<string> | null = null;

/** @font-face rules with the fonts inlined: an SVG drawn as an image can't load anything
 * external, so without this the PNG would fall back to a default font (and labels sized for
 * Satoshi could overflow their boxes). Empty if the font files aren't available. */
function inlineFontCss(): Promise<string> {
  if (!fontCssPromise) {
    const faces: [string, number][] = [["/fonts/Satoshi-Regular.woff2", 400], ["/fonts/Satoshi-Bold.woff2", 700]];
    fontCssPromise = Promise.all(
      faces.map(async ([url, weight]) => {
        const res = await fetch(url);
        if (!res.ok) return "";
        const bytes = new Uint8Array(await res.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return `@font-face{font-family:"Satoshi";font-weight:${weight};src:url(data:font/woff2;base64,${btoa(binary)}) format("woff2");}`;
      })
    )
      .then((rules) => rules.join(""))
      .catch(() => "");
  }
  return fontCssPromise;
}

/** Draws one rectangle of the diagram (viewBox coordinates) at `pixelsPerUnit` device pixels per
 * diagram unit, on white, and returns it as a PNG data URL. */
async function rasterizeBox(d: PreparedDiagram, box: Box, pixelsPerUnit: number): Promise<string> {
  const ratio = Math.min(pixelsPerUnit, MAX_CANVAS_SIDE / width(box), MAX_CANVAS_SIDE / height(box));
  const canvasW = Math.max(1, Math.round(width(box) * ratio));
  const canvasH = Math.max(1, Math.round(height(box) * ratio));

  const doc = new DOMParser().parseFromString(d.svgXml, "image/svg+xml");
  const svg = doc.documentElement;
  svg.setAttribute("viewBox", `${box.x0} ${box.y0} ${width(box)} ${height(box)}`);
  svg.setAttribute("width", String(canvasW));
  svg.setAttribute("height", String(canvasH));
  svg.setAttribute("preserveAspectRatio", "none");
  (svg as unknown as SVGSVGElement).style.removeProperty("max-width");
  const fontCss = await inlineFontCss();
  if (fontCss) {
    const style = doc.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = fontCss;
    svg.insertBefore(style, svg.firstChild);
  }
  const svgDataUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(doc));

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to rasterize diagram to PNG."));
    img.src = svgDataUrl;
  });
  await img.decode().catch(() => undefined);

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvasW, canvasH);
  ctx.drawImage(img, 0, 0, canvasW, canvasH);
  return canvas.toDataURL("image/png");
}

/** The whole diagram at 2x its natural size — the "Download PNG" file, and the copy uploaded with
 * the run (webapp/branding/docx_export.py assumes this 2x when it has nothing better to go on). */
export function rasterizeWholeDiagram(d: PreparedDiagram): Promise<string> {
  return rasterizeBox(d, d.viewBox, 2);
}

// --- Paginating flowcharts with off-page connectors -----------------------------------------------

// Mermaid px a page needs on top of its own steps for an incoming and an outgoing connector row
// (a connector circle plus the rank gap to it). The first estimate only — every page is measured.
// Node centres closer than this (px) along the flow are treated as one row.
const ROW_TOLERANCE_PX = 12;
const MAX_REPAIR_PASSES = 10;

// Label size a paginated flowchart is printed at (pages too wide for it go down to MIN_LABEL_PT).
const PAGINATED_LABEL_PT = 10;

/** Printed scale for one page: the planned scale, or less if that page is too wide for it. */
const pageScaleFor = (page: PreparedDiagram, planned: number) =>
  Math.min(planned, TEXT_WIDTH_PT / (width(page.viewBox) * PX_TO_PT));
/** A page fits if, at its printed scale, it's no taller than the diagram area and its labels are
 * still readable (i.e. it isn't so wide that fitting the page width shrinks them too far). */
const fitsPage = (page: PreparedDiagram, planned: number) => {
  const pageScale = pageScaleFor(page, planned);
  return pageScale >= MIN_SCALE && height(page.viewBox) * PX_TO_PT * pageScale <= MAX_DIAGRAM_HEIGHT_PT;
};

/** Redraws each off-page connector (laid out as a small box, see flowchartPages.ts) as a circle of
 * the box's height, in the connector's own fill and stroke. Only the shape changes. */
function drawConnectorsAsCircles(page: PreparedDiagram): PreparedDiagram {
  const doc = new DOMParser().parseFromString(page.svgXml, "image/svg+xml");
  for (const node of Array.from(doc.querySelectorAll("g.node"))) {
    const nodeId = node.id.match(/-flowchart-(.+)-\d+$/)?.[1];
    if (!nodeId || !CONNECTOR_ID.test(nodeId)) continue;
    const box = node.querySelector("rect.label-container");
    const h = Number(box?.getAttribute("height"));
    const w = Number(box?.getAttribute("width"));
    if (!box || !h || !w) continue;
    const circle = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
    for (const attr of ["class", "style"]) {
      const value = box.getAttribute(attr);
      if (value) circle.setAttribute(attr, value);
    }
    circle.setAttribute("cx", String(Number(box.getAttribute("x")) + w / 2));
    circle.setAttribute("cy", String(Number(box.getAttribute("y")) + h / 2));
    circle.setAttribute("r", String(Math.min(w, h) / 2));
    box.replaceWith(circle);
  }
  return { ...page, svgXml: new XMLSerializer().serializeToString(doc) };
}

/** Splits a top-down flowchart taller than one page into one flowchart per page, joined by
 * off-page connectors. Returns null if this diagram can't be redrawn that way (the caller then
 * slices the image instead).
 *
 * Steps keep their reading order: they're grouped into rows by their position in the full layout,
 * and pages are filled one at a time with as many whole rows as fit. "Fit" is measured, not
 * estimated: each candidate page is rendered by mermaid on its own (with its connectors) and its
 * height compared with the A4 diagram area at that page's scale. */
async function paginateFlowchart(d: PreparedDiagram, scale: number): Promise<DiagramPagePart[] | null> {
  const model = await parseFlowchart(d.source);
  if (!model || !/^(TB|TD|BT)$/.test(model.direction)) return null;
  if (!model.vertices.every((v) => d.nodes[v.id])) return null;
  const flowSign = model.direction === "BT" ? -1 : 1;
  const centre = (id: string) => flowSign * ((d.nodes[id].y0 + d.nodes[id].y1) / 2);

  const rows: string[][] = [];
  for (const id of model.vertices.map((v) => v.id).sort((a, b) => centre(a) - centre(b))) {
    const row = rows[rows.length - 1];
    if (row && centre(id) - centre(row[0]) < ROW_TOLERANCE_PX) row.push(id);
    else rows.push([id]);
  }

  const rendered = new Map<string, PreparedDiagram>();
  const render = async (source: string) => {
    if (!rendered.has(source)) rendered.set(source, await measure(source));
    return rendered.get(source)!;
  };
  /** A page drawn top-down, or — if `sideways` and only that is readable — left-to-right. That's
   * for a row too wide for the page, e.g. a group of five parallel steps: drawn left-to-right
   * they stack vertically. Same steps and links, so it's a layout choice for that page only. */
  const renderPage = async (source: string, sideways: boolean) => {
    const down = await render(source);
    if (!sideways || fitsPage(down, scale)) return down;
    const across = await render(source.replace(/^flowchart (TB|TD|BT)\b/, "flowchart LR"));
    return fitsPage(across, scale) ? across : down;
  };
  const rowPage: number[] = [];
  const pageOfRows = (assignment: number[]) => {
    const pageOf = new Map<string, number>();
    rows.forEach((row, r) => row.forEach((id) => pageOf.set(id, assignment[r])));
    return pageOf;
  };
  /** Rows [start, end) drawn together as `page`, after the pages already filled. */
  const trialPage = async (page: number, start: number, end: number, sideways: boolean) => {
    const trial = rows.map((_, r) => (r < start ? rowPage[r] : r < end ? page : page + 1));
    const flowPages = buildPages(model, pageOfRows(trial), end < rows.length ? page + 2 : page + 1);
    return renderPage(flowPages[page].source, sideways);
  };
  const fits = async (page: number, start: number, end: number, sideways: boolean) =>
    fitsPage(await trialPage(page, start, end, sideways), scale);
  /** True if rows [start, end) fail top-down because they're too wide, not too tall. */
  const tooWideDownwards = async (page: number, start: number, end: number) =>
    pageScaleFor(await trialPage(page, start, end, false), scale) < MIN_SCALE;
  /** The most rows from `start` that fit on `page` (binary search; at least one). */
  const mostRowsThatFit = async (page: number, start: number, sideways: boolean) => {
    let lo = start + 1;
    let hi = rows.length;
    if (await fits(page, start, hi, sideways)) return hi;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (await fits(page, start, mid, sideways)) lo = mid;
      else hi = mid;
    }
    return lo;
  };

  // Fill pages in order, each with the most rows that fit top-down. Left-to-right is only tried
  // when top-down stops because the next row is too wide for the page (e.g. a group of parallel
  // steps), and only used if it then holds more of the flow.
  for (let start = 0, page = 0; start < rows.length; page++) {
    let end = await mostRowsThatFit(page, start, false);
    const firstRowFails = end === start + 1 && !(await fits(page, start, end, false));
    const nextRowTooWide = end < rows.length && (await tooWideDownwards(page, start, end + 1));
    if (firstRowFails || nextRowTooWide) {
      const sidewaysEnd = await mostRowsThatFit(page, start, true);
      if (firstRowFails || sidewaysEnd > end) end = sidewaysEnd;
    }
    for (let r = start; r < end; r++) rowPage[r] = page;
    start = end;
  }

  // Render the final pages (connector letters are only final now) and repair any page that a
  // letter change pushed over, by moving its last row onward.
  let flowPages: FlowPage[] = [];
  let pages: PreparedDiagram[] = [];
  for (let pass = 0; pass < MAX_REPAIR_PASSES; pass++) {
    const pageCount = Math.max(...rowPage) + 1;
    flowPages = buildPages(model, pageOfRows(rowPage), pageCount);
    pages = [];
    for (const fp of flowPages) pages.push(await renderPage(fp.source, true));
    const overflowing = pages.findIndex((p) => !fitsPage(p, scale));
    const lastRow = rowPage.lastIndexOf(overflowing);
    if (overflowing < 0 || rowPage.indexOf(overflowing) === lastRow) break;
    rowPage[lastRow] = overflowing + 1; // rows are in page order, so this keeps reading order
  }

  // Never ship pages that don't say exactly what the original flowchart says.
  if (!(await pagesPreserveFlowchart(model, flowPages))) {
    console.warn("Page split didn't round-trip to the original flowchart; slicing the image instead.");
    return null;
  }

  const parts: DiagramPagePart[] = [];
  for (const [i, page] of pages.entries()) {
    const pageScale = pageScaleFor(page, scale);
    parts.push({
      dataUrl: await rasterizeBox(drawConnectorsAsCircles(page), page.viewBox, Math.max(MIN_PIXELS_PER_UNIT, PRINT_PIXEL_RATIO * pageScale)),
      widthPt: width(page.viewBox) * PX_TO_PT * pageScale,
      heightPt: height(page.viewBox) * PX_TO_PT * pageScale,
      label: pages.length > 1 ? `part ${i + 1} of ${pages.length}` : "",
      kind: pages.length > 1 ? "part" : "whole",
      labelPt: BASE_LABEL_PT * pageScale,
    });
  }
  return parts;
}

/** The diagram laid out for A4 portrait pages: one image per page, each with its printed size. */
export async function layoutDiagramForPages(d: PreparedDiagram): Promise<DiagramPagePart[]> {
  const fit = fitFor(d.viewBox);
  // Doesn't fit one page readably — too tall, too wide, or both. A flowchart is then redrawn
  // page by page with connectors; each page is laid out on its own, so it's usually far narrower
  // than the whole diagram (whose width often comes from long loop-back links).
  if (!fit.readable || height(d.viewBox) * PX_TO_PT * fit.scale > MAX_DIAGRAM_HEIGHT_PT) {
    try {
      const paged = await paginateFlowchart(d, Math.min(MAX_SCALE, PAGINATED_LABEL_PT / BASE_LABEL_PT));
      if (paged) return paged;
    } catch (err) {
      console.warn("Couldn't split the flowchart with page connectors; slicing the image instead.", err);
    }
  }
  const parts: DiagramPagePart[] = [];
  for (const region of planRegions(d)) {
    parts.push({
      dataUrl: await rasterizeBox(d, region.box, Math.max(MIN_PIXELS_PER_UNIT, PRINT_PIXEL_RATIO * region.scale)),
      widthPt: width(region.box) * PX_TO_PT * region.scale,
      heightPt: height(region.box) * PX_TO_PT * region.scale,
      label: region.label,
      kind: region.kind,
      labelPt: BASE_LABEL_PT * region.scale,
    });
  }
  return parts;
}
