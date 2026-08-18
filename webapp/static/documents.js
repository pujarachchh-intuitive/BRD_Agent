/* documents.js
 * Everything about showing the 5 generated documents: tabs, Markdown -> HTML rendering (with live
 * mermaid diagrams substituted in for the `architecture.png` / `flowchart.png` image placeholders),
 * the client-side SVG -> PNG pipeline, DOCX export, and the print/PDF view.
 *
 * Depends on: window.mermaid, window.marked (both vendored, loaded before this file) and the
 * `state` object + api* helpers defined in app.js (loaded after this file, but only invoked from
 * inside event handlers that run after DOMContentLoaded, so load order is not load-bearing here).
 */

let _mermaidUidCounter = 0;
function nextMermaidId(prefix) {
  _mermaidUidCounter += 1;
  return `${prefix}-${Date.now()}-${_mermaidUidCounter}`;
}

const DOC_TAB_CONFIG = [
  { key: "brd", title: "BRD", exportDoc: "brd", filename: "BRD.docx", diagrams: ["flowchart", "architecture"] },
  { key: "tsd", title: "TSD", exportDoc: "tsd", filename: "TSD.docx", diagrams: ["architecture", "flowchart"] },
  { key: "onepager", title: "Executive One-Pager", exportDoc: "onepager", filename: "Executive_OnePager.docx", diagrams: ["architecture"] },
];
const DIAGRAM_TAB_CONFIG = [
  { key: "flowchart", title: "Flowchart" },
  { key: "architecture", title: "Architecture" },
];

/* ---------- Markdown + inline diagram rendering ---------- */

/** Parses `mdText` to HTML and swaps any `![...](architecture.png)` / `![...](flowchart.png)`
 * image reference for a live mermaid container (those files only exist on disk after a DOCX
 * export uploads them, so the <img> src would otherwise 404 / show a broken image icon).
 * Returns { element, mermaidNodes } where mermaidNodes is [{ key, el }] still needing mermaid.run().
 */
function buildMarkdownContent(mdText, mermaidSrcs) {
  const wrapper = document.createElement("div");
  wrapper.className = "markdown-body";
  wrapper.innerHTML = window.marked.parse(mdText || "*(not available)*");

  const mermaidNodes = [];
  const imgs = Array.from(wrapper.querySelectorAll("img"));
  imgs.forEach((img) => {
    const src = img.getAttribute("src") || "";
    let key = null;
    if (/architecture\.png$/i.test(src)) key = "architecture";
    else if (/flowchart\.png$/i.test(src)) key = "flowchart";

    if (key && mermaidSrcs[key]) {
      const figure = document.createElement("figure");
      figure.className = "inline-diagram";
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
      // Diagram not available (or genuinely unrelated image) — drop rather than show a broken icon.
      img.replaceWith(document.createComment(`diagram placeholder omitted: ${src}`));
    }
  });

  return { element: wrapper, mermaidNodes };
}

/* ---------- Building the 5 tab panels ---------- */

/** Rebuilds every tab panel for the given /generate|/revise|/runs/{id} response and wires up
 * their toolbars. Mermaid diagrams are rendered once here and cached (state.diagramSvg) so tab
 * switching and later PNG/DOCX export never need to re-render them.
 */
async function renderAllTabs(data) {
  const panelsContainer = document.getElementById("tab-panels");
  panelsContainer.innerHTML = "";
  state.tabPanels = {};
  state.diagramSvg = {};

  const mermaidSrcs = {
    architecture: data.documents.architecture_mermaid,
    flowchart: data.documents.flowchart_mermaid,
  };

  for (const cfg of DOC_TAB_CONFIG) {
    const panel = document.createElement("div");
    panel.className = "tab-panel";
    panel.dataset.tab = cfg.key;
    panel.appendChild(buildDocToolbar(cfg));
    const scroll = document.createElement("div");
    scroll.className = "doc-scroll";
    panel.appendChild(scroll);
    panelsContainer.appendChild(panel);
    state.tabPanels[cfg.key] = panel;

    // Mermaid needs the element to have real, visible layout to measure text correctly, so we
    // briefly make this panel "active" (in-flow, visible) while its diagrams render.
    panel.classList.add("active");
    const mdText = data.documents[`${cfg.key}_markdown`];
    const { element, mermaidNodes } = buildMarkdownContent(mdText, mermaidSrcs);
    scroll.appendChild(element);
    for (const node of mermaidNodes) {
      try {
        await window.mermaid.run({ nodes: [node.el] });
        const svg = node.el.querySelector("svg");
        if (svg && !state.diagramSvg[node.key]) state.diagramSvg[node.key] = svg;
      } catch (err) {
        console.error(`Failed to render inline ${node.key} diagram`, err);
      }
    }
    panel.classList.remove("active");
  }

  for (const cfg of DIAGRAM_TAB_CONFIG) {
    const panel = document.createElement("div");
    panel.className = "tab-panel";
    panel.dataset.tab = cfg.key;
    panel.appendChild(buildDiagramToolbar(cfg));
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
      state.tabPanels[cfg.key] = panel;

      panel.classList.add("active");
      try {
        await window.mermaid.run({ nodes: [pre] });
        const svg = pre.querySelector("svg");
        if (svg) state.diagramSvg[cfg.key] = svg;
      } catch (err) {
        console.error(`Failed to render ${cfg.key} diagram`, err);
        holder.innerHTML = '<p class="doc-empty">This diagram failed to render.</p>';
      }
      panel.classList.remove("active");
    } else {
      holder.innerHTML = '<p class="doc-empty">No diagram available for this run.</p>';
      panel.appendChild(holder);
      panelsContainer.appendChild(panel);
      state.tabPanels[cfg.key] = panel;
    }
  }

  switchTab(state.activeTab && state.tabPanels[state.activeTab] ? state.activeTab : "brd");
}

function switchTab(tabKey) {
  state.activeTab = tabKey;
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabKey);
  });
  Object.entries(state.tabPanels || {}).forEach(([key, panel]) => {
    panel.classList.toggle("active", key === tabKey);
  });
}

/* ---------- Toolbars ---------- */

function buildDocToolbar(cfg) {
  const bar = document.createElement("div");
  bar.className = "doc-toolbar";

  const downloadBtn = document.createElement("button");
  downloadBtn.type = "button";
  downloadBtn.className = "btn btn-secondary";
  downloadBtn.textContent = "Download DOCX";
  downloadBtn.addEventListener("click", () => exportDocDocx(cfg, downloadBtn));
  bar.appendChild(downloadBtn);

  const printBtn = document.createElement("button");
  printBtn.type = "button";
  printBtn.className = "btn btn-secondary";
  printBtn.textContent = "Print / Save as PDF";
  printBtn.addEventListener("click", () => printDocument(cfg));
  bar.appendChild(printBtn);

  return bar;
}

function buildDiagramToolbar(cfg) {
  const bar = document.createElement("div");
  bar.className = "doc-toolbar";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-secondary";
  btn.textContent = "Download PNG";
  btn.addEventListener("click", () => downloadDiagramPng(cfg.key, btn));
  bar.appendChild(btn);
  return bar;
}

/* ---------- SVG -> PNG pipeline ---------- */

function svgToPngDataUrl(svg) {
  return new Promise((resolve, reject) => {
    let { width, height } = svg.getBoundingClientRect();
    if (!width || !height) {
      const vb = svg.viewBox && svg.viewBox.baseVal;
      if (vb && vb.width && vb.height) {
        width = vb.width;
        height = vb.height;
      }
    }
    if (!width || !height) {
      width = 900;
      height = 600;
    }

    const svgString = new XMLSerializer().serializeToString(svg);
    const svgDataUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgString);

    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = width * 2;
        canvas.height = height * 2;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.scale(2, 2);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/png"));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error("Failed to rasterize diagram to PNG."));
    img.src = svgDataUrl;
  });
}

function triggerDownload(href, filename) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function downloadDiagramPng(key, btn) {
  const svg = state.diagramSvg[key];
  if (!svg) {
    showError(`No ${key} diagram is available to download for this run.`);
    return;
  }
  const originalLabel = btn ? btn.textContent : null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Preparing...";
  }
  try {
    const dataUrl = await svgToPngDataUrl(svg);
    triggerDownload(dataUrl, `${key}.png`);
  } catch (err) {
    showError(err.message || String(err));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }
}

/* ---------- DOCX export ---------- */

async function exportDocDocx(cfg, btn) {
  if (!state.currentRunId) {
    showError("No active run to export.");
    return;
  }
  const originalLabel = btn ? btn.textContent : null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Exporting...";
  }
  clearError();
  try {
    const payload = {};
    for (const key of cfg.diagrams) {
      const svg = state.diagramSvg[key];
      if (svg) {
        payload[key] = await svgToPngDataUrl(svg);
      }
    }
    if (Object.keys(payload).length) {
      await apiUploadDiagrams(state.currentRunId, payload);
    }
    const blob = await apiExportDocx(state.currentRunId, cfg.exportDoc);
    const blobUrl = URL.createObjectURL(blob);
    triggerDownload(blobUrl, cfg.filename);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
  } catch (err) {
    showError(err.message || String(err));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }
}

/* ---------- Print / Save as PDF ---------- */

function printDocument(cfg) {
  const panel = state.tabPanels[cfg.key];
  const content = panel && panel.querySelector(".doc-scroll");
  if (!content) {
    showError("Nothing to print yet.");
    return;
  }
  const printRoot = document.getElementById("print-root");
  printRoot.innerHTML = "";
  const heading = document.createElement("h1");
  heading.className = "print-title";
  heading.textContent = cfg.title;
  printRoot.appendChild(heading);
  printRoot.appendChild(content.cloneNode(true));
  window.print();
}

/* ---------- Assumptions + consistency panels ---------- */

function renderAssumptions(reqJson) {
  const panel = document.getElementById("assumptions-panel");
  const list = document.getElementById("assumptions-list");
  const assumptions = (reqJson && reqJson.assumptions) || [];
  list.innerHTML = "";
  if (!assumptions.length) {
    panel.hidden = true;
    return;
  }
  for (const item of assumptions) {
    const li = document.createElement("li");
    li.textContent = item;
    list.appendChild(li);
  }
  panel.hidden = false;
}

function renderConsistencyPanel(reportMd) {
  const panel = document.getElementById("consistency-panel");
  const content = document.getElementById("consistency-content");
  if (!reportMd) {
    panel.hidden = true;
    return;
  }
  content.innerHTML = window.marked.parse(reportMd);
  const head = reportMd.slice(0, 400);
  const looksClean = /\bPASS\b/i.test(head) || /no contradictions/i.test(head);
  panel.classList.toggle("consistency-pass", looksClean);
  panel.classList.toggle("consistency-warn", !looksClean);
  panel.hidden = false;
}

function renderRunBadge(data) {
  const badge = document.getElementById("run-badge");
  let text = `Run: ${data.run_id}`;
  if (data.parent_run_id) {
    text += ` (revised from ${data.parent_run_id})`;
  }
  badge.textContent = text;
}

/* ---------- Top-level: render a full generate/revise/load response ---------- */

async function renderResults(data) {
  state.currentRunId = data.run_id;
  state.currentData = data;

  // Unhide the results section (and hide the form) BEFORE building tabs: renderAllTabs briefly
  // makes each tab panel "active" (in-flow/visible) so mermaid can measure text correctly while
  // rendering, but that only works if none of its ancestors are display:none — a `hidden`
  // results-section would collapse all descendant layout regardless of the panel's own display,
  // giving mermaid a zero-size element to measure on the very first render of a session.
  document.getElementById("form-section").hidden = true;
  document.getElementById("results-section").hidden = false;
  document.getElementById("new-request-btn").hidden = false;

  renderRunBadge(data);
  renderAssumptions(data.requirements_json);
  renderConsistencyPanel(data.consistency_report);
  await renderAllTabs(data);

  document.getElementById("results-section").scrollIntoView({ behavior: "smooth", block: "start" });
}
