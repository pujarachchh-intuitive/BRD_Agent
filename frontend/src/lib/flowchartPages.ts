// Splits a mermaid flowchart into one mermaid flowchart per printed page, joined by off-page
// connectors — the standard flowchart convention: where a link crosses a page break, the step on
// the first page points to a lettered circle (A), and the continuation on the later page starts
// from a circle with the same letter.
//
// The pages are rebuilt from mermaid's own parse of the diagram (its flowchart database), not by
// editing the source text, so every node keeps its exact shape and label, and every link keeps its
// line style, arrowhead and label. A link that crosses pages is drawn as source -> (A) on one page
// and (A) -> target on the other, with its label on the first half. Nothing is dropped or reworded.
//
// Subgraphs (titled groups of steps) are kept: each page draws every group that has steps on it,
// with the same title, nesting and direction, around just that page's steps.
//
// A link to or from a whole group arrives on the page where the group starts, or leaves from the
// page where it ends, with connectors like any other link.
//
// Flowcharts using features this can't rebuild exactly (click links, markdown labels, newer shape
// syntax) return null from parseFlowchart, and the caller falls back to cutting the rendered image
// into page-sized slices instead.

import { mermaid } from "./mermaidSetup";

interface Vertex {
  id: string;
  type?: string;
  text?: string;
  labelType: string;
  classes: string[];
  styles: string[];
  link?: string;
  haveCallback?: boolean;
  icon?: string;
  img?: string;
}

interface Edge {
  start: string;
  end: string;
  type?: string;
  stroke?: string;
  text: string;
  labelType: string;
  style?: string[];
}

interface FlowClass {
  id: string;
  styles: string[];
}

interface SubGraph {
  id: string;
  title: string;
  labelType: string;
  nodes: string[];
  dir?: string;
  classes: string[];
}

export interface FlowModel {
  direction: string;
  vertices: Vertex[];
  edges: Edge[];
  classes: FlowClass[];
  subgraphs: SubGraph[];
  /** Vertex id -> the innermost subgraph it belongs to (absent if it's in none). */
  groupOf: Map<string, string>;
  /** Subgraph id -> the subgraph directly containing it (absent for top-level ones). */
  parentOf: Map<string, string>;
}

interface FlowDb {
  getDirection(): string | undefined;
  getVertices(): Map<string, Vertex>;
  getEdges(): Edge[];
  getClasses(): Map<string, FlowClass>;
  getSubGraphs(): SubGraph[];
}

/** Innermost containing subgraph of each vertex and subgraph. Mermaid's member lists may or may
 * not repeat a nested group's members in its ancestors, so "innermost" = the smallest group that
 * lists the id — which gives the same answer either way. */
function groupStructure(subgraphs: SubGraph[]) {
  const bySize = [...subgraphs].sort((a, b) => a.nodes.length - b.nodes.length);
  const innermost = (id: string) => bySize.find((sg) => sg.id !== id && sg.nodes.includes(id))?.id;
  const groupOf = new Map<string, string>();
  const parentOf = new Map<string, string>();
  const subgraphIds = new Set(subgraphs.map((sg) => sg.id));
  for (const sg of subgraphs) {
    for (const member of sg.nodes) {
      const group = innermost(member);
      if (!group) continue;
      (subgraphIds.has(member) ? parentOf : groupOf).set(member, group);
    }
  }
  return { groupOf, parentOf };
}

/** Whether vertex `id` sits inside subgraph `group`, directly or through nested groups. */
function isInside(model: Pick<FlowModel, "groupOf" | "parentOf">, id: string, group: string): boolean {
  for (let g = model.groupOf.get(id); g; g = model.parentOf.get(g)) if (g === group) return true;
  return false;
}

// mermaid vertex type -> [open, close] delimiters around a quoted label.
const SHAPES: Record<string, [string, string]> = {
  square: ["[", "]"],
  round: ["(", ")"],
  stadium: ["([", "])"],
  subroutine: ["[[", "]]"],
  cylinder: ["[(", ")]"],
  circle: ["((", "))"],
  doublecircle: ["(((", ")))"],
  diamond: ["{", "}"],
  hexagon: ["{{", "}}"],
  odd: [">", "]"],
  lean_right: ["[/", "/]"],
  lean_left: ["[\\", "\\]"],
  trapezoid: ["[/", "\\]"],
  inv_trapezoid: ["[\\", "/]"],
};

const ARROW_ENDS: Record<string, string> = { arrow_point: ">", arrow_open: "", arrow_cross: "x", arrow_circle: "o" };
const DOUBLE_STARTS: Record<string, string> = { ">": "<", x: "x", o: "o" };

/** The mermaid link token for an edge (`-->`, `-.->`, `==x`, `<-->`, ...), or null if unknown. */
function linkToken(edge: Edge): string | null {
  const stroke = edge.stroke ?? "normal";
  if (stroke === "invisible") return "~~~";
  const type = edge.type ?? "arrow_point";
  const isDouble = type.startsWith("double_");
  const end = ARROW_ENDS[type.replace(/^double_/, "")];
  if (end === undefined) return null;
  const start = isDouble ? DOUBLE_STARTS[end] : "";
  if (isDouble && !start) return null;
  if (stroke === "normal") return `${start}--${end || "-"}`;
  if (stroke === "thick") return `${start}==${end || "="}`;
  if (stroke === "dotted") return `${start}-.-${end}`;
  return null;
}

const quote = (text: string) => `"${text.replace(/"/g, "#quot;")}"`;

/** Mermaid's parse of a flowchart, or null if it isn't a flowchart this module can rebuild exactly. */
export async function parseFlowchart(source: string, allowConnectors = false): Promise<FlowModel | null> {
  let db: FlowDb;
  try {
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(source);
    if (!/^flowchart/.test(diagram.type)) return null;
    db = diagram.db as unknown as FlowDb;
  } catch {
    return null;
  }
  const subgraphs = db.getSubGraphs();
  const subgraphIds = new Set(subgraphs.map((sg) => sg.id));
  // A link to or from a whole subgraph makes mermaid list the subgraph as a vertex too.
  const vertices = [...db.getVertices().values()].filter((v) => !subgraphIds.has(v.id));
  const edges = db.getEdges();
  const ids = new Set(vertices.map((v) => v.id));
  // Connector ids are reserved (and only ever appear when re-parsing a page built here).
  if (!allowConnectors && [...ids, ...subgraphIds].some((id) => CONNECTOR_ID.test(id))) return null;
  const supported =
    vertices.every((v) => (v.type === undefined || v.type in SHAPES) && v.labelType !== "markdown" && !v.link && !v.haveCallback && !v.icon && !v.img) &&
    edges.every((e) => {
      const endpointOk = (id: string) => ids.has(id) || subgraphIds.has(id);
      return linkToken(e) !== null && e.labelType !== "markdown" && endpointOk(e.start) && endpointOk(e.end);
    }) &&
    subgraphs.every((sg) => sg.labelType !== "markdown" && sg.nodes.every((n) => ids.has(n) || subgraphIds.has(n)));
  if (!supported) return null;
  const structure = groupStructure(subgraphs);
  // An empty group has nothing to put on any page; rather than drop it, don't split this chart.
  if (!subgraphs.every((sg) => vertices.some((v) => isInside(structure, v.id, sg.id)))) return null;
  return {
    direction: db.getDirection() || "TB",
    vertices,
    edges,
    classes: [...db.getClasses().values()],
    subgraphs,
    ...structure,
  };
}

// Connectors are laid out as small square boxes and redrawn as circles of the same height once
// rendered (diagramLayout.ts, drawConnectorsAsCircles): mermaid pads a circle's label by a fixed
// 32px all round, which would make a one-letter connector ~100px across and cost each page a lot
// of height for nothing.
const connectorNode = (id: string, letter: string) => `${id}[${quote(letter)}]`;
export const CONNECTOR_ID = /^zz(In|Out)_\w+$/;
const CONNECTOR_CLASS = "zzPageConnector";
// Brand blue (#003AE3), matching the document headings, so connectors read as navigation aids.
const CONNECTOR_CLASS_DEF = `classDef ${CONNECTOR_CLASS} fill:#ffffff,stroke:#003AE3,stroke-width:2px,color:#003AE3,font-weight:bold`;

/** Spreadsheet-style connector letters: A..Z, AA, AB, ... */
function connectorLetter(index: number): string {
  let n = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}

export interface FlowPage {
  source: string;
  nodeIds: string[];
}

/** Builds one flowchart per page. pageOf maps each vertex id to its page index (0-based); pages
 * are returned in order, with off-page connectors for every link between two pages. */
export function buildPages(model: FlowModel, pageOf: Map<string, number>, pageCount: number): FlowPage[] {
  // A link can also start or end at a whole group (subgraph): it arrives on the page where the
  // group starts and leaves from the page where the group ends.
  const groupPages = (group: string) =>
    model.vertices.filter((v) => isInside(model, v.id, group)).map((v) => pageOf.get(v.id)!);
  const startPageOf = (id: string) => pageOf.get(id) ?? Math.max(...groupPages(id));
  const endPageOf = (id: string) => pageOf.get(id) ?? Math.min(...groupPages(id));

  // One letter per step or group that some link reaches from another page, in reading order.
  const order = [...model.vertices.map((v) => v.id), ...model.subgraphs.map((sg) => sg.id)];
  const letterOf = new Map<string, string>();
  [...new Set(model.edges.filter((e) => startPageOf(e.start) !== endPageOf(e.end)).map((e) => e.end))]
    .sort((a, b) => endPageOf(a) - endPageOf(b) || order.indexOf(a) - order.indexOf(b))
    .forEach((id, i) => letterOf.set(id, connectorLetter(i)));

  const pages: FlowPage[] = [];
  for (let page = 0; page < pageCount; page++) {
    const lines = [`flowchart ${model.direction}`];
    for (const cls of model.classes) {
      if (cls.styles.length) lines.push(`classDef ${cls.id} ${cls.styles.join(",")}`);
    }
    lines.push(CONNECTOR_CLASS_DEF);

    const onPage = model.vertices.filter((v) => pageOf.get(v.id) === page);
    // Letters of the connectors this page continues from. An incoming connector has no links
    // into it, so mermaid places it in the top row.
    const incoming = new Set(
      model.edges.filter((e) => endPageOf(e.end) === page && startPageOf(e.start) !== page).map((e) => letterOf.get(e.end)!)
    );
    for (const v of onPage) {
      const [open, close] = SHAPES[v.type ?? "square"];
      lines.push(`${v.id}${open}${quote(v.text ?? v.id)}${close}`);
    }

    // Groups with steps on this page, nested as in the original, around this page's steps only.
    const hasStepsHere = (group: string) => onPage.some((v) => isInside(model, v.id, group));
    const emitGroup = (sg: SubGraph) => {
      lines.push(`subgraph ${sg.id}[${quote(sg.title)}]`);
      if (sg.dir) lines.push(`direction ${sg.dir}`);
      for (const child of model.subgraphs) {
        if (model.parentOf.get(child.id) === sg.id && hasStepsHere(child.id)) emitGroup(child);
      }
      for (const v of onPage) if (model.groupOf.get(v.id) === sg.id) lines.push(v.id);
      lines.push("end");
    };
    for (const sg of model.subgraphs) {
      if (!model.parentOf.has(sg.id) && hasStepsHere(sg.id)) emitGroup(sg);
    }
    for (const sg of model.subgraphs) {
      const classes = sg.classes.filter((c) => c !== "default");
      if (classes.length && hasStepsHere(sg.id)) lines.push(`class ${sg.id} ${classes.join(",")}`);
    }

    const linkStyles: string[] = [];
    let linkIndex = 0;
    const addLink = (from: string, edge: Edge, to: string, withLabel: boolean) => {
      const label = withLabel && edge.text && edge.stroke !== "invisible" ? `|${quote(edge.text)}|` : "";
      lines.push(`${from} ${linkToken(edge)}${label} ${to}`);
      if (edge.style && edge.style.length) linkStyles.push(`linkStyle ${linkIndex} ${edge.style.join(",")}`);
      linkIndex += 1;
    };

    const connectorIds = new Set<string>();
    for (const letter of incoming) {
      lines.push(connectorNode(`zzIn_${letter}`, letter));
      connectorIds.add(`zzIn_${letter}`);
    }
    for (const e of model.edges) {
      const startPage = startPageOf(e.start);
      const endPage = endPageOf(e.end);
      if (startPage === page && endPage === page) {
        addLink(e.start, e, e.end, true);
      } else if (startPage === page) {
        const letter = letterOf.get(e.end)!;
        if (!connectorIds.has(`zzOut_${letter}`)) lines.push(connectorNode(`zzOut_${letter}`, letter));
        connectorIds.add(`zzOut_${letter}`);
        addLink(e.start, e, `zzOut_${letter}`, true);
      } else if (endPage === page) {
        // The label was already shown on the outgoing half, on the page the link starts from.
        addLink(`zzIn_${letterOf.get(e.end)}`, e, e.end, false);
      }
    }

    for (const v of onPage) {
      const classes = v.classes.filter((c) => c !== "default");
      if (classes.length) lines.push(`class ${v.id} ${classes.join(",")}`);
      if (v.styles.length) lines.push(`style ${v.id} ${v.styles.join(",")}`);
    }
    if (connectorIds.size) lines.push(`class ${[...connectorIds].join(",")} ${CONNECTOR_CLASS}`);
    lines.push(...linkStyles);

    pages.push({ source: lines.join("\n"), nodeIds: onPage.map((v) => v.id) });
  }
  return pages;
}

const vertexKey = (v: Vertex) => [v.id, v.type ?? "square", v.text ?? v.id, v.classes.filter((c) => c !== "default").join(","), v.styles.join(",")].join("|");
const edgeKey = (e: Pick<Edge, "start" | "end" | "text" | "type" | "stroke">) =>
  [e.start, e.end, e.stroke === "invisible" ? "" : e.text, e.type ?? "arrow_point", e.stroke ?? "normal"].join("|");
const groupKey = (sg: SubGraph) => [sg.title, sg.dir ?? "", sg.classes.filter((c) => c !== "default").join(",")].join("|");

/** Proof that the pages say exactly what the original flowchart says: parses every page back with
 * mermaid, joins each connector pair back into the link it stands for, and checks the result has
 * the same steps (shape, label, styling), the same links (ends, label, line and arrow style), and
 * the same groups (title, direction, nesting) holding the same steps. */
export async function pagesPreserveFlowchart(model: FlowModel, pages: FlowPage[]): Promise<boolean> {
  const vertices: string[] = [];
  const edges: string[] = [];
  const outgoing: Edge[] = [];
  const targetOf = new Map<string, string>();
  const groupOfStep = new Map<string, string>();
  const groups = new Map<string, string>(); // subgraph id -> title/direction/classes + parent
  for (const page of pages) {
    const parsed = await parseFlowchart(page.source, true);
    if (!parsed) return false;
    for (const sg of parsed.subgraphs) {
      const key = `${groupKey(sg)}|${parsed.parentOf.get(sg.id) ?? ""}`;
      if (groups.has(sg.id) && groups.get(sg.id) !== key) return false;
      groups.set(sg.id, key);
    }
    for (const v of parsed.vertices) {
      if (CONNECTOR_ID.test(v.id)) continue;
      vertices.push(vertexKey(v));
      groupOfStep.set(v.id, parsed.groupOf.get(v.id) ?? "");
    }
    for (const e of parsed.edges) {
      const inLetter = e.start.match(/^zzIn_(\w+)$/)?.[1];
      if (inLetter) {
        if (targetOf.has(inLetter) && targetOf.get(inLetter) !== e.end) return false;
        targetOf.set(inLetter, e.end);
      } else if (/^zzOut_\w+$/.test(e.end)) {
        outgoing.push(e);
      } else {
        edges.push(edgeKey(e));
      }
    }
  }
  for (const e of outgoing) {
    const target = targetOf.get(e.end.slice("zzOut_".length));
    if (!target) return false;
    edges.push(edgeKey({ ...e, end: target }));
  }
  const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");
  return (
    same(vertices, model.vertices.map(vertexKey)) &&
    same(edges, model.edges.map(edgeKey)) &&
    model.vertices.every((v) => groupOfStep.get(v.id) === (model.groupOf.get(v.id) ?? "")) &&
    groups.size === model.subgraphs.length &&
    model.subgraphs.every((sg) => groups.get(sg.id) === `${groupKey(sg)}|${model.parentOf.get(sg.id) ?? ""}`)
  );
}
