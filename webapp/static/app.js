/* app.js
 * State, API calls, form building/collection, and event wiring. Rendering of the generated
 * documents (tabs, mermaid, PNG/DOCX export, print) lives in documents.js.
 */

const state = {
  currentRunId: null,
  currentData: null,
  activeTab: "brd",
  tabPanels: {},
  diagramSvg: {},
};

const RUN_HISTORY_KEY = "brdAgentSuite.runHistory";

/* ---------- API ---------- */

async function handleJsonResponse(res) {
  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    data = null;
  }
  if (!res.ok) {
    const detail = data && data.detail ? data.detail : `Request failed (${res.status})`;
    throw new Error(detail);
  }
  return data;
}

async function apiGenerate(payload) {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleJsonResponse(res);
}

async function apiRevise(runId, changeRequest) {
  const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/revise`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ change_request: changeRequest }),
  });
  return handleJsonResponse(res);
}

async function apiGetRun(runId) {
  const res = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
  return handleJsonResponse(res);
}

async function apiUploadDiagrams(runId, payload) {
  const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/diagrams`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleJsonResponse(res);
}

async function apiExportDocx(runId, doc) {
  const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/export/${doc}`, { method: "POST" });
  if (!res.ok) {
    let detail = `Export failed (${res.status})`;
    try {
      const data = await res.json();
      if (data && data.detail) detail = data.detail;
    } catch (err) {
      /* response wasn't JSON — keep the generic message */
    }
    throw new Error(detail);
  }
  return res.blob();
}

/* ---------- Error banner + loading state ---------- */

function showError(msg) {
  const banner = document.getElementById("error-banner");
  banner.textContent = msg;
  banner.hidden = false;
  banner.scrollIntoView({ behavior: "smooth", block: "start" });
}

function clearError() {
  const banner = document.getElementById("error-banner");
  banner.hidden = true;
  banner.textContent = "";
}

function setLoading(isLoading, message) {
  document.getElementById("loading-section").hidden = !isLoading;
  if (message) document.getElementById("loading-message").textContent = message;
  document.getElementById("generate-btn").disabled = isLoading;
  document.getElementById("revise-btn").disabled = isLoading;
  document.getElementById("run-history").disabled = isLoading;
  document.getElementById("new-request-btn").disabled = isLoading;
}

/* ---------- Run history (localStorage) ---------- */

function loadRunHistory() {
  try {
    return JSON.parse(localStorage.getItem(RUN_HISTORY_KEY)) || [];
  } catch (err) {
    return [];
  }
}

function saveRunHistory(list) {
  localStorage.setItem(RUN_HISTORY_KEY, JSON.stringify(list));
}

function addRunToHistory(entry) {
  const list = loadRunHistory();
  list.unshift({ ...entry, created_at: new Date().toISOString() });
  saveRunHistory(list.slice(0, 50));
  populateRunHistoryDropdown();
}

function populateRunHistoryDropdown() {
  const select = document.getElementById("run-history");
  const list = loadRunHistory();
  select.innerHTML = '<option value="">Load a previous run…</option>';
  for (const entry of list) {
    const opt = document.createElement("option");
    opt.value = entry.run_id;
    const label = entry.project_name ? entry.project_name : entry.run_id;
    opt.textContent = entry.parent_run_id ? `↳ ${label} (revision) — ${entry.run_id}` : `${label} — ${entry.run_id}`;
    select.appendChild(opt);
  }
  select.value = state.currentRunId || "";
}

/* ---------- Form building ---------- */

function buildForm() {
  const container = document.getElementById("form-sections");
  container.innerHTML = "";
  for (const section of FORM_SECTIONS) {
    const details = document.createElement("details");
    details.className = "form-section";
    details.open = true;
    const summary = document.createElement("summary");
    summary.textContent = section.title;
    details.appendChild(summary);
    const body = document.createElement("div");
    body.className = "form-section-body";
    for (const fieldName of section.fields) {
      body.appendChild(buildFieldRow(fieldName, FIELD_DEFS[fieldName]));
    }
    details.appendChild(body);
    container.appendChild(details);
  }
}

function buildFieldRow(name, def) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  if (def.prominent) wrap.classList.add("field-prominent");

  const headerRow = document.createElement("div");
  headerRow.className = "field-header";

  // critical: foundational identity, can't be invented or omitted (no auto, no exclude).
  // noExclude: must always appear in the document per the reference BRDs/TSDs — every structural
  // section in both real examples was substantively populated, none were blank/omitted — but the AI
  // can still help fill it in.
  // skipToggles: additional_sections only — neither concept applies to purely optional user content.
  const isRequired = def.critical || def.noExclude;
  const label = document.createElement("label");
  label.textContent = isRequired ? `${def.label} (required)` : def.label;
  if (def.kind !== "list_obj") label.htmlFor = `field-${name}`;
  headerRow.appendChild(label);

  const toggles = document.createElement("div");
  toggles.className = "field-toggles";
  headerRow.appendChild(toggles);

  let autoCheckbox = null;
  let excludeCheckbox = null;
  const showAuto = !def.critical && !def.skipToggles;
  const showExclude = showAuto && !def.noExclude;
  if (showAuto) {
    const autoWrap = document.createElement("label");
    autoWrap.className = "auto-toggle";
    autoCheckbox = document.createElement("input");
    autoCheckbox.type = "checkbox";
    autoCheckbox.id = `auto-${name}`;
    autoWrap.appendChild(autoCheckbox);
    autoWrap.appendChild(document.createTextNode(" Auto-generate / enrich"));
    toggles.appendChild(autoWrap);
  }
  if (showExclude) {
    const excludeWrap = document.createElement("label");
    excludeWrap.className = "exclude-toggle";
    excludeCheckbox = document.createElement("input");
    excludeCheckbox.type = "checkbox";
    excludeCheckbox.id = `exclude-${name}`;
    excludeWrap.appendChild(excludeCheckbox);
    excludeWrap.appendChild(document.createTextNode(" Not applicable — omit this section"));
    toggles.appendChild(excludeWrap);
  }

  wrap.appendChild(headerRow);

  if (def.helper) {
    const helper = document.createElement("p");
    helper.className = "field-helper";
    helper.textContent = def.helper;
    wrap.appendChild(helper);
  }

  if (def.kind === "scalar") {
    const el = def.input === "textarea" ? document.createElement("textarea") : document.createElement("input");
    el.id = `field-${name}`;
    if (def.input === "textarea") el.rows = def.prominent ? 4 : 3;
    else el.type = "text";
    if (def.placeholder) el.placeholder = def.placeholder;
    wrap.appendChild(el);
  } else if (def.kind === "list_str") {
    const el = document.createElement("textarea");
    el.id = `field-${name}`;
    el.rows = 3;
    el.placeholder = "One item per line";
    wrap.appendChild(el);
  } else if (def.kind === "list_obj") {
    const rowsContainer = document.createElement("div");
    rowsContainer.className = "repeater-rows";
    rowsContainer.id = `rows-${name}`;
    wrap.appendChild(rowsContainer);

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn btn-secondary btn-small";
    addBtn.textContent = "+ Add";
    addBtn.addEventListener("click", () => addRepeaterRow(name, def, rowsContainer));
    wrap.appendChild(addBtn);
  }

  if (autoCheckbox) {
    autoCheckbox.addEventListener("change", () => {
      // Auto-generate and exclude are mutually exclusive: enriching a section and omitting it
      // entirely can't both be true at once. (excludeCheckbox may not exist at all for a noExclude
      // field — it always has auto available but never an exclude option.)
      if (autoCheckbox.checked && excludeCheckbox && excludeCheckbox.checked) {
        excludeCheckbox.checked = false;
        setFieldExcludeState(wrap, name, def, false);
      }
      setFieldAutoState(wrap, name, def, autoCheckbox.checked);
    });
  }
  if (excludeCheckbox) {
    excludeCheckbox.addEventListener("change", () => {
      if (excludeCheckbox.checked && autoCheckbox && autoCheckbox.checked) {
        autoCheckbox.checked = false;
        setFieldAutoState(wrap, name, def, false);
      }
      setFieldExcludeState(wrap, name, def, excludeCheckbox.checked);
    });
  }

  return wrap;
}

function addRepeaterRow(name, def, container) {
  const row = document.createElement("div");
  row.className = "repeater-row";
  for (const sf of def.subfields) {
    const cell = document.createElement("div");
    cell.className = "repeater-cell";
    const lbl = document.createElement("label");
    lbl.textContent = sf.label;
    cell.appendChild(lbl);

    let input;
    if (sf.type === "select") {
      input = document.createElement("select");
      for (const opt of sf.options) {
        const optionEl = document.createElement("option");
        optionEl.value = opt;
        optionEl.textContent = opt;
        if (opt === sf.default) optionEl.selected = true;
        input.appendChild(optionEl);
      }
    } else if (sf.type === "textarea") {
      input = document.createElement("textarea");
      input.rows = 3;
      if (sf.placeholder) input.placeholder = sf.placeholder;
    } else {
      input = document.createElement("input");
      input.type = "text";
      if (sf.placeholder) input.placeholder = sf.placeholder;
    }
    input.dataset.subfield = sf.name;
    cell.appendChild(input);
    row.appendChild(cell);
  }

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "btn-remove";
  removeBtn.textContent = "×";
  removeBtn.title = "Remove row";
  removeBtn.setAttribute("aria-label", "Remove row");
  removeBtn.addEventListener("click", () => row.remove());
  row.appendChild(removeBtn);

  container.appendChild(row);
}

function setFieldAutoState(wrap, name, def, isAuto) {
  // Inputs stay editable either way: leaving a field blank + auto-generate means "invent this from
  // scratch," but typing something first + auto-generate means "use this as a seed and enrich it."
  // Only the visual styling changes, as a hint that whatever's here will be expanded on, not final.
  wrap.classList.toggle("is-auto", isAuto);
}

function setFieldExcludeState(wrap, name, def, isExcluded) {
  // Unlike auto-generate, "excluded" really does mean this section is irrelevant to the project, so
  // its inputs are disabled — there's nothing meaningful to type for a section that won't appear.
  wrap.classList.toggle("is-excluded", isExcluded);
  if (def.kind === "list_obj") {
    const rowsContainer = document.getElementById(`rows-${name}`);
    const addBtn = wrap.querySelector(".btn-small");
    if (addBtn) addBtn.disabled = isExcluded;
    rowsContainer.querySelectorAll("input, select, textarea, button").forEach((el) => {
      el.disabled = isExcluded;
    });
  } else {
    const el = document.getElementById(`field-${name}`);
    el.disabled = isExcluded;
  }
}

/* ---------- Form collection ---------- */

/** Reads whatever is currently in a field's inputs, regardless of its auto-generate checkbox state.
 * Auto-generate no longer means "ignore this input" — a field checked auto WITH content typed in is
 * sent as a seed for the AI to enrich; checked auto with nothing typed means "generate from scratch."
 * Only auto_fields (below) carries the "please touch this" signal; the value itself is always real.
 */
function readFieldValue(name, def) {
  if (def.kind === "scalar") {
    const el = document.getElementById(`field-${name}`);
    return el.value.trim();
  }
  if (def.kind === "list_str") {
    const el = document.getElementById(`field-${name}`);
    return el.value
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  // list_obj
  const container = document.getElementById(`rows-${name}`);
  const rows = Array.from(container.querySelectorAll(".repeater-row"));
  return rows.map((row) => {
    const obj = {};
    for (const sf of def.subfields) {
      const input = row.querySelector(`[data-subfield="${sf.name}"]`);
      if (sf.isList) {
        obj[sf.name] = input.value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        obj[sf.name] = input.value.trim();
      }
    }
    return obj;
  });
}

function collectFormData() {
  const form = {};
  const autoFields = [];
  const excludedSections = [];

  for (const [name, def] of Object.entries(FIELD_DEFS)) {
    form[name] = readFieldValue(name, def);
    const autoCheckbox = document.getElementById(`auto-${name}`);
    if (autoCheckbox && autoCheckbox.checked) {
      autoFields.push(name);
    }
    const excludeCheckbox = document.getElementById(`exclude-${name}`);
    if (excludeCheckbox && excludeCheckbox.checked) {
      excludedSections.push(name);
    }
  }

  return { form, auto_fields: autoFields, excluded_sections: excludedSections };
}

function isFieldValueEmpty(value, def) {
  if (def.kind === "scalar") return !value;
  return (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.every((item) =>
      typeof item === "string" ? !item.trim() : Object.values(item).every((v) => !v || (Array.isArray(v) && !v.length))
    )
  );
}

/** Auto-generate now means "enrich a seed," not "invent from nothing" — so every field needs at
 * least one real point from the user before submission, not just the critical ones. The two
 * exceptions: a field the user explicitly marked "not applicable" (that's a deliberate, meaningful
 * empty, not a gap), and additional_sections (genuinely optional — there's nothing to seed).
 * Checking "auto-generate" does not exempt a field from this; it only changes what happens to
 * whatever the user did type.
 */
function validateRequiredFields(form, excludedSections) {
  const excluded = new Set(excludedSections || []);
  const missing = [];
  for (const [name, def] of Object.entries(FIELD_DEFS)) {
    if (def.skipToggles || excluded.has(name)) continue;
    if (isFieldValueEmpty(form[name], def)) missing.push(def.label);
  }
  if (!missing.length) return null;
  return (
    "Please add at least one point to every field before generating (or mark it \"Not applicable\" " +
    `if it genuinely doesn't apply): ${missing.join(", ")}.`
  );
}

/* ---------- Wiring ---------- */

function resetToForm() {
  document.getElementById("results-section").hidden = true;
  document.getElementById("form-section").hidden = false;
  document.getElementById("new-request-btn").hidden = true;
  document.getElementById("run-history").value = "";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function wireEvents() {
  document.getElementById("brd-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    clearError();
    const payload = collectFormData();
    const validationError = validateRequiredFields(payload.form, payload.excluded_sections);
    if (validationError) {
      showError(validationError);
      return;
    }
    setLoading(true, "Generating your documents — this usually takes 30-90 seconds...");
    try {
      const data = await apiGenerate(payload);
      addRunToHistory({ run_id: data.run_id, project_name: data.requirements_json.project_name, parent_run_id: null });
      await renderResults(data);
    } catch (err) {
      showError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  });

  document.getElementById("revise-btn").addEventListener("click", async () => {
    const textarea = document.getElementById("revise-input");
    const changeRequest = textarea.value.trim();
    if (!changeRequest) {
      showError("Please describe the change you'd like before applying it.");
      return;
    }
    if (!state.currentRunId) {
      showError("No active run to revise.");
      return;
    }
    clearError();
    setLoading(true, "Applying your change — this usually takes 30-90 seconds...");
    try {
      const data = await apiRevise(state.currentRunId, changeRequest);
      addRunToHistory({
        run_id: data.run_id,
        project_name: data.requirements_json.project_name,
        parent_run_id: data.parent_run_id,
      });
      textarea.value = "";
      await renderResults(data);
    } catch (err) {
      showError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  });

  document.getElementById("run-history").addEventListener("change", async (event) => {
    const runId = event.target.value;
    if (!runId) return;
    clearError();
    setLoading(true, "Loading run...");
    try {
      const data = await apiGetRun(runId);
      await renderResults(data);
    } catch (err) {
      showError(err.message || String(err));
      populateRunHistoryDropdown();
    } finally {
      setLoading(false);
    }
  });

  document.getElementById("new-request-btn").addEventListener("click", resetToForm);

  document.getElementById("doc-tabs").addEventListener("click", (event) => {
    const btn = event.target.closest(".tab-btn");
    if (!btn) return;
    switchTab(btn.dataset.tab);
  });
}

/* ---------- Init ---------- */

document.addEventListener("DOMContentLoaded", () => {
  window.mermaid.initialize({ startOnLoad: false, theme: "default" });
  buildForm();
  populateRunHistoryDropdown();
  wireEvents();
});
