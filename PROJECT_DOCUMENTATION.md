# BRD Agent Suite — Complete Project Documentation

This document is a from-scratch rebuild guide and full technical reference for this project as it
stands. It covers *what* the system does, *why* it's built the way it is, the complete folder
structure, every module's responsibility, the data model, the "database" (there isn't a
conventional one — see below), the frontend architecture, the request/response flow end to end,
and exact setup/run instructions. If this repo were deleted, a competent engineer should be able to
rebuild an equivalent system from this document alone.

Last updated: 2026-09-22. Reflects commit `38bb7ed` ("Frontend updated") plus uncommitted
in-progress work (dashboard analytics + history tree view — see "Current state" at the bottom).

---

## 1. What this project is

A multi-agent AI system that turns a plain-English project description into **five professional
documents**:

1. **BRD** — Business Requirements Document
2. **TSD** — Technical Specification Document
3. **Flowchart** — a Mermaid process/data-flow diagram
4. **Architecture diagram** — a Mermaid system-architecture diagram
5. **Executive One-Pager** — a leadership summary for a go/no-go decision

It is built on **Google ADK (Agent Development Kit) + Gemini**. There are two front doors into the
same underlying pipeline:

- **`adk web`** — ADK's own built-in chat UI. Free-text conversation; the agent asks up to 3
  batched clarifying questions if critical information is missing, otherwise generates immediately.
- **The custom webapp** (`frontend/` Next.js + `webapp/` FastAPI) — a dashboard + structured form +
  results viewer with per-field "auto-generate/enrich" toggles, live Mermaid rendering, DOCX
  export, print-to-PDF, and an iterative "request a change" (revision) flow.

Both front doors write to the **same output directory** on disk
(`brd_agent_suite/output/<run_id>/`), so a run created via `adk web` shows up in the webapp
dashboard and vice versa.

---

## 2. High-level architecture

```
                              ┌─ extraction_agent    (chat flow: free prose -> structured JSON)
first stage, one of ─────────┼─ gap_filler_agent     (form flow: completes/enriches marked fields)
                              └─ revision_agent       (revise flow: applies a change request)
                                        │
                                        ▼
                         ParallelAgent: brd_agent, tsd_agent, flowchart_agent,
                                        architecture_agent, onepager_agent
                                        │
                                        ▼
                              consistency_check_agent  (flags contradictions across all five)
```

All three entry flows (chat / form / revision) funnel into the **same**
`pipeline.build_document_pipeline()` factory and share the **same five generator prompts** — only
the first stage differs, and it always produces (or receives) the same `RequirementsModel` JSON
object that every downstream generator reads from.

Key architectural decisions baked into the code:

- **One shared schema** (`RequirementsModel` in `schema.py`) is the single source of truth every
  document is generated from. Nothing is generated directly from raw user text except this
  structured object.
- **ADK agents are single-parent** — an agent instance can only belong to one `sub_agents` tree.
  Because of this, every pipeline that needs its own copy of the five generators calls a `build_*`
  factory function to construct **fresh instances** rather than reuse a shared singleton. The chat
  flow's pipeline (`document_pipeline` in `pipeline.py`) is built once at import time since ADK's
  `adk web`/`api_server` reuse one `root_agent` (and its whole sub-tree) across every concurrent
  session safely. The webapp's form/revision flows build a **new** pipeline per request
  (`webapp/service.py`) because each request needs its own agent tree.
- **No conventional database.** Everything is plain files on disk (see Section 6).
- **Diagrams are rendered client-side**, never server-side — no headless browser, no Node/`mmdc`
  dependency on the backend at all.

---

## 3. Complete folder structure

```
BRD_Agent/                              (repo root)
├── .env                                # GOOGLE_API_KEY (gitignored, not in repo)
├── .env.example                        # template for the above
├── requirements.txt                    # Python deps (see Section 4.1)
├── README.md                           # user-facing quickstart (kept in sync with this doc)
├── .venv/                              # Python virtualenv (gitignored)
├── .claude/                            # Claude Code local settings (not part of the app)
│
├── brd_agent_suite/                    # ── THE AGENT SYSTEM (Python / Google ADK) ──
│   ├── __init__.py
│   ├── agent.py                        # root_agent — the adk-web-facing conversational agent
│   ├── config.py                       # MODEL_NAME, pricing table, env name — single control point
│   ├── schema.py                       # RequirementsModel (the shared Pydantic schema)
│   ├── rubric.py                       # completeness rubric -> clarifying-question policy (data, not prose)
│   ├── pipeline.py                     # build_document_pipeline() factory + ParallelAgent wiring
│   ├── tools.py                        # generate_all_documents tool + run_pipeline_and_write() engine
│   ├── observability.py                # per-LLM-call JSONL logging (tokens, latency, cost)
│   ├── logs_viewer.py                  # small CLI/script to inspect logs/*.jsonl (dev utility)
│   ├── .adk/
│   │   └── session.db                  # ADK CLI's OWN session store for `adk web`/`adk run` — see Section 6
│   ├── logs/
│   │   └── <run_id>.jsonl              # one file per run; one JSON line per LLM call (see Section 8)
│   ├── output/
│   │   └── <run_id>/                   # one folder per run — the actual "database" (see Section 6)
│   │       ├── requirements.json
│   │       ├── BRD.md
│   │       ├── TSD.md
│   │       ├── flowchart.mmd
│   │       ├── architecture.mmd
│   │       ├── Executive_OnePager.md
│   │       ├── consistency_report.md
│   │       ├── run_meta.json
│   │       ├── architecture.png        # only after a DOCX export from the webapp
│   │       ├── flowchart.png           # only after a DOCX export from the webapp
│   │       ├── BRD.docx                # only after export
│   │       ├── TSD.docx                # only after export
│   │       └── Executive_OnePager.docx # only after export
│   ├── prompts/                        # every generator's instruction text, one file per agent
│   │   ├── root_prompt.py              # ROOT_INSTRUCTION (chat orchestrator)
│   │   ├── extraction_prompt.py        # free prose -> RequirementsModel
│   │   ├── gap_filler_prompt.py        # partial form -> complete RequirementsModel
│   │   ├── revision_prompt.py          # existing RequirementsModel + change request -> revised one
│   │   ├── brd_prompt.py               # RequirementsModel -> BRD.md
│   │   ├── tsd_prompt.py               # RequirementsModel -> TSD.md
│   │   ├── flowchart_prompt.py         # RequirementsModel -> flowchart.mmd (Mermaid)
│   │   ├── architecture_prompt.py      # RequirementsModel -> architecture.mmd (Mermaid)
│   │   ├── onepager_prompt.py          # RequirementsModel -> Executive_OnePager.md
│   │   └── consistency_prompt.py       # all 5 outputs -> consistency_report.md
│   └── sub_agents/                     # one LlmAgent (or build_*() factory) per prompt above
│       ├── extraction_agent.py
│       ├── gap_filler_agent.py         # build_gap_filler_agent()
│       ├── revision_agent.py           # build_revision_agent()
│       ├── brd_agent.py                # build_brd_agent()
│       ├── tsd_agent.py                # build_tsd_agent()
│       ├── flowchart_agent.py          # build_flowchart_agent()
│       ├── architecture_agent.py       # build_architecture_agent()
│       ├── onepager_agent.py           # build_onepager_agent()
│       └── consistency_check_agent.py  # build_consistency_check_agent()
│
├── webapp/                             # ── FASTAPI BACKEND for the custom UI ──
│   ├── __init__.py
│   ├── server.py                       # FastAPI app + routes (thin — no business logic)
│   └── service.py                      # all business logic: form normalization, run listing,
│                                        # revision, DOCX export, dashboard aggregation
│
└── frontend/                           # ── NEXT.JS FRONTEND ──
    ├── package.json                    # see Section 4.2 for the dependency list
    ├── next.config.ts                  # /api/* rewrite proxy to the FastAPI backend
    ├── tsconfig.json
    ├── .env.local.example              # BACKEND_URL override template
    ├── public/                         # static assets (favicons, default Next.js SVGs — unused)
    └── src/
        ├── app/                        # Next.js App Router pages
        │   ├── layout.tsx              # root layout: <Sidebar> + <main>{children}</main>
        │   ├── globals.css             # entire design system: CSS variables, components, dark mode
        │   ├── page.tsx                # "/" — dashboard (stats tiles, charts, recent runs)
        │   ├── new/
        │   │   └── page.tsx            # "/new" — the structured request form
        │   ├── history/
        │   │   └── page.tsx            # "/history" — full run history as a searchable tree
        │   └── runs/[runId]/
        │       └── page.tsx            # "/runs/<id>" — a single run's results + revise flow
        ├── components/
        │   ├── ErrorBanner.tsx
        │   ├── LoadingSection.tsx
        │   ├── RunCard.tsx             # one run's summary row (used by dashboard + history)
        │   ├── layout/
        │   │   ├── Sidebar.tsx         # collapsible left nav (Dashboard/New Request/History)
        │   │   └── TopBar.tsx          # per-page header bar
        │   ├── dashboard/
        │   │   ├── ConsistencyMeter.tsx
        │   │   ├── CostByAgentChart.tsx
        │   │   ├── CostOverTimeChart.tsx
        │   │   └── RunsPerDayChart.tsx
        │   ├── form/
        │   │   ├── RequestForm.tsx     # the full form: sections, submit, validation wiring
        │   │   ├── FieldRow.tsx        # one field: label + input + auto-generate/exclude toggles
        │   │   ├── RepeaterField.tsx   # add/remove-rows UI for list_obj fields (objectives, risks, ...)
        │   │   └── SectionNav.tsx      # jump-to-section sidebar within the form
        │   └── results/
        │       ├── ResultsView.tsx     # tabs shell + revise box + export/print wiring
        │       ├── SummaryHeader.tsx   # project name, run id, assumption/requirement counts
        │       ├── AssumptionsPanel.tsx
        │       ├── ConsistencyPanel.tsx
        │       └── RevisePanel.tsx     # "request a change" textarea + submit
        └── lib/
            ├── api.ts                  # every fetch() call to /api/* (single source of truth)
            ├── types.ts                # TS types mirroring the backend's JSON shapes
            ├── formConfig.ts           # field definitions (kind, label, subfields, critical/noExclude flags)
            ├── formSections.ts         # groups fields into the form's visual sections
            ├── formLogic.ts            # validation + payload assembly (CollectedForm)
            ├── demoData.ts             # "Fill Demo Data" button's canned example
            ├── documentRenderer.ts     # imperative Markdown+Mermaid tab renderer (see Section 9.4)
            ├── mermaidSetup.ts         # mermaid.initialize() config
            ├── mermaidLabels.ts        # wraps long Mermaid node labels for readability
            ├── svgToPng.ts             # client-side SVG -> PNG via <canvas>, for export/download
            ├── runId.ts                # parses a run_id's embedded UTC timestamp
            ├── runHistory.ts           # localStorage-backed "recently viewed runs" (per-browser only)
            ├── runTree.ts              # groups flat run list into a parent/revision forest
            └── dashboardStats.ts       # all dashboard aggregation math (see Section 9.3)
```

---

## 4. Dependencies

### 4.1 Python (`requirements.txt`)

```
google-adk>=2.7.0        # Google Agent Development Kit — agents, Runner, sessions, ParallelAgent, etc.
pydantic>=2.0             # RequirementsModel + structured LLM output schemas
python-dotenv>=1.0        # loads .env for GOOGLE_API_KEY
fastapi>=0.110            # webapp/server.py
uvicorn>=0.29              # ASGI server to run FastAPI
python-multipart>=0.0.9    # required by FastAPI for certain request types
```

Also required but **not** a pip package: **`pandoc`**, installed system-wide (this project used
`winget` on Windows). Used only for Markdown → DOCX conversion during export.

### 4.2 Frontend (`frontend/package.json`)

Runtime:
- `next` 16.3.5 (App Router, TypeScript)
- `react` / `react-dom` 19.2.8
- `mermaid` ^12.0.0 — client-side diagram rendering, no CDN/server dependency
- `marked` ^18.0.13 — Markdown → HTML
- `lucide-react` — icon set used throughout the UI
- `clsx` — conditional className helper
- `@tailwindcss/typography` — prose styling for rendered Markdown

Dev/build: `typescript`, `tailwindcss` v4 + `@tailwindcss/postcss`, `eslint` + `eslint-config-next`,
`@types/*`.

Node package manager used: npm (there's a `package-lock.json`, no yarn/pnpm lockfile).

---

## 5. Environment configuration

**Root `.env`** (copy from `.env.example`):
```
GOOGLE_API_KEY=your-key-here
```
Get a key from https://aistudio.google.com/apikey (Google AI Studio / Gemini Developer API).

Optional: `APP_ENV` (development/staging/production) — read by `brd_agent_suite/config.py`,
surfaced into every log record's `metadata.env`. Defaults to `development`.

**`frontend/.env.local`** (copy from `frontend/.env.local.example`, optional):
```
BACKEND_URL=http://127.0.0.1:8000
```
Only needed if the FastAPI backend runs somewhere other than `127.0.0.1:8000`.

Important gotcha documented in `webapp/server.py`: unlike `adk web`/`adk run`, a plain `uvicorn`
process does **not** auto-load `.env`. `server.py` explicitly calls
`load_dotenv(dotenv_path=<repo_root>/.env)` **before** importing anything from `brd_agent_suite`
that touches the Gemini client — otherwise `GOOGLE_API_KEY` is missing at request time.

---

## 6. The "database" — how data is actually persisted

**There is no relational/document database in this system.** Persistence is 100% the filesystem,
by design (simplicity, zero infra, trivially inspectable). There are three distinct on-disk stores,
easy to confuse — spelled out precisely:

### 6.1 `brd_agent_suite/output/<run_id>/` — the real data store

This is the actual "database." Every run (from either front door) creates one folder here, named
by a sortable run id: `f"{utc_timestamp:%Y%m%d-%H%M%S}-{uuid4().hex[:6]}"` (e.g.
`20260916-102505-98ab75`), generated by `tools.new_run_id()`. Sorting run folders by name = sorting
by creation time.

Files written into each run folder (from `tools.OUTPUT_FILES` + `write_run_meta`):

| File | Written by | Contents |
|---|---|---|
| `requirements.json` | pipeline (state key `requirements_json`) | The full `RequirementsModel`, pretty-printed |
| `BRD.md` | `brd_agent` | Business Requirements Document, Markdown |
| `TSD.md` | `tsd_agent` | Technical Spec Document, Markdown |
| `flowchart.mmd` | `flowchart_agent` | Raw Mermaid flowchart source |
| `architecture.mmd` | `architecture_agent` | Raw Mermaid architecture diagram source |
| `Executive_OnePager.md` | `onepager_agent` | Leadership one-pager, Markdown |
| `consistency_report.md` | `consistency_check_agent` | Cross-document contradiction report |
| `run_meta.json` | `tools.write_run_meta()` | `{started_at, finished_at, duration_seconds, parent_run_id}` |
| `architecture.png` / `flowchart.png` | webapp export flow only | PNG rendered client-side, uploaded before DOCX export |
| `BRD.docx` / `TSD.docx` / `Executive_OnePager.docx` | webapp export flow only, via `pandoc` | Word documents |

`GET /api/runs` (the dashboard's data source) works by **scanning this directory** — every
subfolder that contains a `requirements.json` counts as a run. There is no separate index,
manifest, or registry; the directory listing *is* the query. This is explicitly called out in the
README: "this is what powers the dashboard, and is genuinely everything on disk, not something
tracked separately."

`run_meta.json`'s `parent_run_id` is the **only** place a revision's lineage is recorded — a
revision's own `requirements_json` carries no memory of what run it came from, so without this
field the History page couldn't nest a revision under its original run.

### 6.2 `brd_agent_suite/logs/<run_id>.jsonl` — observability, not application state

One JSON-Lines file per run, one line per individual LLM call within that run's pipeline (so a
single "run" produces several log lines — one per agent that made a model call: extraction/gap
filler/revision, brd, tsd, flowchart, architecture, onepager, consistency check).

Written by `observability.py` via three ADK callback hooks attached to **every** `LlmAgent`:
`before_model_callback` / `after_model_callback` / `on_model_error_callback`. Each pair brackets
exactly one model call — deliberately more reliable for timing than watching
`Runner.run_async`'s yielded events, which interleave across the parallel agents.

Each line's shape:
```json
{
  "timestamp": "...", "agent_id": "brd_agent", "request_id": "req_...",
  "provider": "google", "model": "gemini-3.7-flash",
  "input_tokens": 1234, "output_tokens": 567, "total_tokens": 1801,
  "latency_ms": 3120, "status": "success", "error_type": null,
  "input_cost_usd": 0.000925, "output_cost_usd": 0.002126, "estimated_cost_usd": 0.003051,
  "metadata": {"endpoint": "generate_content", "env": "development", "run_id": "...", "invocation_id": "..."}
}
```
Cost is computed from `config.MODEL_PRICING_PER_1M_TOKENS` (currently only
`gemini-3.7-flash: {input: 0.75, output: 3.75}` USD/1M tokens); a model missing from that table logs
null costs rather than guessing.

`webapp/service.py._aggregate_run_log()` reads these files to compute per-run token/cost totals
and a per-agent cost breakdown for the dashboard. **These logs are optional/best-effort** — runs
generated before this instrumentation existed have no log file, and every consumer treats that as
"unknown," never "zero."

### 6.3 `brd_agent_suite/.adk/session.db` — ADK CLI's own store, unrelated to the webapp

This SQLite file is created and managed entirely by the Google ADK CLI (`adk web` / `adk run`) to
persist **chat session state** (conversation turns, session state) between CLI invocations. **The
webapp never touches this file.** The webapp's own pipeline runs
(`tools.run_pipeline_and_write`) use ADK's `InMemorySessionService` — a session that exists purely
for the duration of one HTTP request and is discarded immediately after; nothing about it is
persisted beyond the output files written at the end. Do not confuse `.adk/session.db` (ADK chat
history) with `output/<run_id>/` (the actual generated documents) — they serve completely
different purposes and neither depends on the other.

**Summary: if you were rebuilding this system and looking for "the database schema," there isn't
one to design. The schema that matters is `schema.RequirementsModel` (a Pydantic model), and the
storage layer is "write it to a JSON/Markdown file in a folder named after the run."**

---

## 7. The shared schema — `brd_agent_suite/schema.py`

`RequirementsModel` (Pydantic `BaseModel`) is the one object every document is generated from.
Produced once (by extraction/gap-filler/revision — whichever ran as the pipeline's first stage),
then templated as `{requirements_json}` into every downstream generator's instruction string.
Fields:

- `project_name: str`
- `doc_id_acronym: str` — a 3-5 letter uppercase acronym, decided **once** here so every document
  references the identical value (`BRD-<acronym>-001`, etc.) instead of each generator inventing
  its own.
- `problem_statement: str`
- `business_context: str`
- `objectives: list[Objective]` — `{id, objective, success_measure}` — id like `OBJ-01`
- `stakeholders: list[Stakeholder]` — `{role, interest}`
- `target_users: list[TargetUser]` — `{persona, needs}`
- `scope_in: list[str]`
- `scope_deferred: list[DeferredScopeItem]` — `{item, why_deferred}`
- `scope_permanently_excluded: list[str]`
- `functional_requirements: list[FunctionalRequirement]` — `{id, description, priority: M/S/C}` — id
  like `BR-01`, MoSCoW priority, **stable id carried unchanged into the TSD traceability table**
- `non_functional_requirements: list[NonFunctionalRequirement]` — `{category, requirement}`
- `assumptions: list[str]` — every rubric-inferred field must add an entry here
- `constraints: list[str]`
- `risks: list[Risk]` — `{id, risk, impact: High/Medium/Low, mitigation}` — id like `R-01`
- `success_metrics: list[str]`
- `dependencies: list[str]`
- `tech_stack_preferences: list[str]`
- `system_components: list[SystemComponent]` — `{name, responsibility, interacts_with: list[str]}`
- `data_flow_steps: list[str]` — sequential narrative steps
- `integrations: list[str]`
- `timeline_phases: list[TimelinePhase]` — `{phase, content, exit_criteria}`
- `open_questions: list[str]`
- `decision_audience: str` — who this is pitched to; drives the one-pager's tone and "THE ASK" framing
- `excluded_sections: list[str]` — field names the user explicitly said don't apply; BRD/TSD
  generators omit that section entirely rather than render it empty. Never allowed for a critical
  field (project_name, problem_statement, stakeholders, target_users, functional_requirements).
- `additional_sections: list[AdditionalSection]` — `{title, content}` — user-authored custom
  sections appended to BRD/TSD; not used by the one-pager (fixed template).

This schema is passed as Gemini **structured output** (`output_schema=RequirementsModel`) on the
extraction/gap-filler/revision agents, guaranteeing valid JSON matching this shape every time.

---

## 8. Backend deep dive — `brd_agent_suite/`

### 8.1 `config.py` — single control point
- `MODEL_NAME = "gemini-3.7-flash"` — the **one place** to change the working model everywhere.
  Comment in the code flags that `gemini-2.5-flash` (the original default) is scheduled for
  shutdown 2026-10-16 on the Gemini Developer API — verify model availability via
  `client.models.list()` before repointing this.
- `PROVIDER_NAME = "google"`
- `OUTPUT_DIR_NAME = "output"`, `LOGS_DIR_NAME = "logs"`, `APP_NAME = "brd_agent_suite"`
- `ENVIRONMENT` — from `APP_ENV` env var, default `"development"`
- `MODEL_PRICING_PER_1M_TOKENS` — USD per 1M tokens, keyed by model name, used for cost logging

### 8.2 `agent.py` — the chat-facing root agent
`root_agent` is an `LlmAgent` named `brd_intake_agent`. Its **only tool** is
`generate_all_documents` (from `tools.py`). Its instruction (`ROOT_INSTRUCTION` in
`prompts/root_prompt.py`) tells it to:
1. Apply the completeness rubric (`rubric.CLARIFYING_QUESTION_POLICY`) to decide whether to ask up
   to 3 batched clarifying questions, or proceed straight to generation making flagged assumptions.
2. Once ready, compose ONE consolidated prose brief (original description + any Q&A answers +
   an explicit note if the user asked it to "use your best judgment") and call
   `generate_all_documents(context=<brief>)` exactly once.
3. After the tool returns, relay results conversationally — confirm the 5 documents, list any
   non-trivial assumptions, **always surface the consistency report** (never silently swallow a
   found contradiction), and flag any `missing` documents rather than claiming full success.

This is the agent `adk web brd_agent_suite` picks up and drives.

### 8.3 `rubric.py` — completeness rubric as data
`RUBRIC: list[RubricField]` — each entry is `{field, level: Critical/Important/"Nice to have",
if_missing: <policy string>}`. Ten rows cover: problem statement, target users/stakeholders,
objectives, scope boundaries, functional requirements, non-functional constraints, tech
constraints, timeline, risks/open questions, one-pager audience.

`render_rubric_markdown()` renders it as a Markdown table; `CLARIFYING_QUESTION_POLICY` wraps that
table with the actual decision policy text (ask if Critical missing; infer + flag assumption if
only Important/Nice-to-have missing; skip straight to inference if the user explicitly says "best
guess"/"your judgment"/"skip the questions"). This is injected into `ROOT_INSTRUCTION` — the point
being the policy is generated from **one source of data**, not duplicated by hand inside a prompt
string.

### 8.4 `pipeline.py` — the pipeline factory
- `build_document_generators() -> ParallelAgent` — wraps fresh instances of brd/tsd/flowchart/
  architecture/onepager agents so they run concurrently, all reading the same
  `{requirements_json}` state.
- `build_document_pipeline(first_stage, name="document_pipeline") -> SequentialAgent` — the
  reusable factory: `[first_stage, build_document_generators(), build_consistency_check_agent()]`.
  `first_stage` must write `{requirements_json}` to session state via its `output_key` — same
  contract `extraction_agent` follows.
- `document_pipeline = build_document_pipeline(extraction_agent)` — the chat flow's singleton,
  built once at import time (safe to reuse because `adk web`/`api_server` share one `root_agent`
  tree across concurrent sessions, and `extraction_agent` here is itself a plain singleton, not a
  `build_*()` factory — it's only ever used in this one pipeline).

The webapp (`webapp/service.py`) calls `build_document_pipeline(build_gap_filler_agent(), ...)` or
`build_document_pipeline(build_revision_agent(), ...)` fresh **per HTTP request**, because ADK's
single-parent constraint means a brand-new agent tree is required each time.

### 8.5 `tools.py` — the execution engine
- `new_run_id()` — `f"{utc_now:%Y%m%d-%H%M%S}-{uuid4().hex[:6]}"`
- `OUTPUT_FILES` — the state-key → (filename, kind) map described in Section 6.1
- `write_run_meta(run_dir, started_at, finished_at, duration_seconds, parent_run_id)` — writes
  `run_meta.json`
- `write_state_outputs(run_dir, state)` — writes whichever of `OUTPUT_FILES` are present in the
  final session state; returns `(written_files, missing_keys)` so callers can tell a partial
  failure (e.g. one generator errored) from full success
- `run_pipeline_and_write(pipeline_agent, run_id, *, message_text=None, initial_state=None,
  parent_run_id=None)` — **the shared engine** behind all three flows:
  1. Creates a fresh `InMemorySessionService` + session (`session_id=run_id`, seeded with
     `initial_state` if given)
  2. Creates a `Runner(agent=pipeline_agent, ...)` and drains
     `runner.run_async(...)` — the agents write everything to session state via their
     `output_key`s, so the loop body is just `pass`
  3. Reads back the final session state, writes files to `output/<run_id>/`, writes
     `run_meta.json`
  4. Returns a dict: `run_id, output_dir, files, missing, duration_seconds, parent_run_id,
     requirements_json, documents{...}, consistency_report`
- `generate_all_documents(context: str) -> dict` — the LLM-facing **tool function** the chat
  `root_agent` calls. Generates a new `run_id`, calls `run_pipeline_and_write(document_pipeline,
  run_id, message_text=context)`, and returns a **trimmed** dict (run_id, output_dir, files,
  missing, consistency_report only — no JSON blobs, since the chat agent only needs paths + the
  report text to relay conversationally).

### 8.6 `observability.py` — see Section 6.2 above for the log format; mechanically it hooks
`before_model_callback`/`after_model_callback`/`on_model_error_callback` on every `LlmAgent`
(attached identically in `agent.py` and every `sub_agents/*.py` file), using a
`(invocation_id, agent_name)`-keyed stack (`_pending_calls`) to pair each before/after call
correctly even if an agent somehow makes more than one model call per invocation.

### 8.7 `sub_agents/` and `prompts/` — one pair per pipeline stage

Every file in `sub_agents/` follows the same shape: import `MODEL_NAME`, the three observability
callbacks, its prompt constant, and (for the four stages with structured output) `RequirementsModel`.
Generator agents (`brd_agent`, `tsd_agent`, `flowchart_agent`, `architecture_agent`,
`onepager_agent`, `consistency_check_agent`) all expose a `build_*()` factory (plus, for
`brd_agent`/`consistency_check_agent`, a module-level singleton used by the chat pipeline).
`gap_filler_agent` and `revision_agent` are factory-only (no singleton — webapp-only flows).
`extraction_agent` is singleton-only (chat-flow-only).

| Agent | Input state | Output (`output_key`) | Structured output? |
|---|---|---|---|
| `extraction_agent` | free-text message | `requirements_json` | Yes (`RequirementsModel`) |
| `gap_filler_agent` | `{partial_requirements_json}`, `{auto_fields}` | `requirements_json` | Yes |
| `revision_agent` | `{requirements_json}` + change-request message | `requirements_json` | Yes |
| `brd_agent` | `{requirements_json}` | `brd_markdown` | No (plain Markdown text) |
| `tsd_agent` | `{requirements_json}` | `tsd_markdown` | No |
| `flowchart_agent` | `{requirements_json}` | `flowchart_mermaid` | No (Mermaid source text) |
| `architecture_agent` | `{requirements_json}` | `architecture_mermaid` | No |
| `onepager_agent` | `{requirements_json}` | `onepager_markdown` | No |
| `consistency_check_agent` | all five outputs above | `consistency_report` | No |

Prompt file sizes for reference (roughly proportional to how much output structure each enforces):
`tsd_prompt.py` (144 lines) and `brd_prompt.py` (126) are the longest/most structured; the two
diagram prompts (`flowchart_prompt.py` 29, `architecture_prompt.py` 32) are short since Mermaid
syntax itself is the main constraint; `consistency_prompt.py` (56) defines what counts as a
contradiction; `gap_filler_prompt.py` (73) and `revision_prompt.py` (53) both carefully specify
"preserve everything not explicitly marked / not explicitly requested to change" semantics.

---

## 9. Frontend deep dive — `frontend/`

Next.js 16, App Router, TypeScript, Tailwind CSS v4. **API-only** — no server-side data fetching of
its own; every page is a client component (`"use client"`) that calls the FastAPI backend through
`src/lib/api.ts` via relative `/api/*` paths, which `next.config.ts` rewrites to
`http://127.0.0.1:8000` (or `BACKEND_URL`) — identical code path in dev and production, no CORS
config needed.

`next.config.ts` also: sets `experimental.proxyTimeout = 180000` (30s default is too short — the
Gemini pipeline can take 30-90s), sets `allowedDevOrigins: ["127.0.0.1", "localhost"]` (Next dev
otherwise blocks cross-origin dev-endpoint access), and `devIndicators: false` (hides the floating
dev badge that overlaps the sidebar footer).

### 9.1 Pages (`src/app/`)
- **`/` (`page.tsx`)** — the dashboard. On mount, calls `apiListRuns()`, then computes all
  dashboard stats client-side (see 9.3) and renders: a hero CTA, 7 stat tiles (total runs, runs
  this week, avg generation time, total est. cost, unique projects, documents generated,
  consistency pass rate), 4 charts/panels (runs per day, cost by agent, cost over time, consistency
  meter), and a "Recent runs" list (first 6 `RunCard`s) linking to `/history` for the rest.
- **`/new` (`page.tsx`)** — hosts `<RequestForm>`. On submit, calls `apiGenerate()`, records the
  new run in `localStorage` history (`addRunToHistory`), and routes to `/runs/<run_id>`.
- **`/history` (`page.tsx`)** — fetches all runs, builds a **tree** via `runTree.buildRunTree()`
  (roots = runs with no recognized parent; each run's revisions nest under it), supports a live
  text search across project name + run id (a match anywhere in a family keeps the whole family
  visible, so a revision match still shows its parent as context), and renders each tree recursively
  via `<RunTreeItem>` with indentation + a left border per depth level.
- **`/runs/[runId]` (`page.tsx`)** — fetches one run via `apiGetRun`, renders `<ResultsView>`.
  Handles the "request a change" flow: `handleRevise(changeRequest)` calls `apiRevise`, records the
  new (child) run in history, and **navigates to the new run's own URL** — the original run's page
  is untouched, preserving it as a permanent, bookmarkable version. State management note: fetch
  result is keyed by the `runId` it was fetched *for* (not just written eagerly), so "loading" and
  "stale previous run's data" are derived by comparing `runId` to `fetchResult.runId` — avoids a
  separate imperatively-managed loading flag that could drift out of sync during fast navigation.

### 9.2 The form system (`components/form/` + `lib/formConfig.ts`, `formSections.ts`, `formLogic.ts`)
`formConfig.ts` defines one `FieldDef` per `RequirementsModel` field — mirroring
`webapp/service.py`'s `FORM_FIELDS` list field-for-field (kept in sync by hand; there's no shared
schema file between Python and TypeScript). Each field's `kind` is `"scalar" | "list_str" |
"list_obj"`; `list_obj` fields additionally declare `subfields` (e.g. an `objectives` row has
`objective` + `success_measure` subfields). Flags per field: `critical` (no auto-generate, no
exclude, always required — `project_name`, `problem_statement`, `stakeholders`, `target_users`),
`noExclude` (must always be present, but can still be auto-generated), `skipToggles`
(`additional_sections` only — neither toggle applies). `formSections.ts` groups fields into the
form's visible sections; `SectionNav.tsx` renders a jump-to-section rail. `RequestForm.tsx` renders
every section, collects values, and calls `formLogic`'s validation/assembly into a
`CollectedForm { form, auto_fields, excluded_sections }` payload — the exact shape
`POST /api/generate` expects. `RepeaterField.tsx` renders the add/remove-row UI for every
`list_obj` field. `demoData.ts` backs the "Fill Demo Data" button with one canned realistic example.

### 9.3 Dashboard analytics (`lib/dashboardStats.ts`, `components/dashboard/`)
All computed **client-side** from the flat `GET /api/runs` response — no dedicated backend
aggregation endpoint.
- `computeDashboardStats` — total runs, runs in the last 7 days (via `runId.parseRunTimestamp`,
  which reads the UTC timestamp embedded in the run id string), unique project count, documents
  generated (`runs.length * 5`), average duration, total cost.
- `computeConsistencyStats` — pass/fail/rate from each run's `consistency_status` (real data, no
  estimation — every run has a `consistency_report.md`).
- `computeRunsPerDay` / `computeCostOverTime` — zero-filled day buckets for the last 14 days.
- `computeCostByAgent` — sums each run's `cost_by_agent` map, labels agent ids with friendlier
  names (`AGENT_LABELS`), sorted highest-cost first. **Real data only** (empty array, not
  zero-valued rows, if no run has log data — a fabricated per-agent split would have no basis).
- **Deliberate design choice, documented in code**: for runs generated *before* the
  duration/cost/token instrumentation existed (no `run_meta.json` / no `logs/<run_id>.jsonl`), a
  **seeded-random deterministic estimate** (stable per run id, not re-randomized on every render)
  fills in duration (35-75s) and cost ($0.03-$0.13) — ranges drawn from this project's own observed
  real runs — purely so old runs don't drag the dashboard's headline averages down to "no data" or
  falsely to zero. This is presentation-layer polish only; the underlying API data and any
  per-run display elsewhere are untouched, only the aggregate dashboard stats use the filled value.

### 9.4 Document rendering — `lib/documentRenderer.ts`
Deliberately **not** modeled as React state. Reasoning documented in the file: Mermaid needs real,
laid-out DOM nodes to measure and wrap text into, and the rendered `<svg>` nodes are cached and
reused later for PNG/DOCX export — modeling that as React state would mean re-deriving DOM nodes
from state, backwards for this use case. Instead, `DocumentRenderer` is a plain class that:
1. Parses each document's Markdown via `marked`, building real DOM nodes
2. Finds `![...](architecture.png)` / `![...](flowchart.png)` image placeholders in the parsed HTML
   (these files don't exist on disk yet — diagrams are generated as raw Mermaid text, not images)
   and replaces each with a live `<pre class="mermaid">` container holding the actual `.mmd` source
3. Calls `mermaid.run({nodes: [...]})` to render each container to an inline `<svg>`, caching the
   `<svg>` element per diagram key for reuse
4. Guards against overlapping renders (React Strict Mode double-invokes effects in dev, and two
   runs could race in prod) via a monotonic `renderEpoch` stamped on the shared container element
   itself — any older, still-in-flight render checks this and bails rather than fighting a newer
   render for the same DOM
5. Exposes per-tab toolbars: "Download DOCX" (see 9.5), "Print / Save as PDF" (clones the panel's
   content into a dedicated print-only root and calls `window.print()` — **zero server
   involvement**, pure browser Print dialog against a print-optimized CSS view), "Download PNG"
   (diagram tabs only, via `svgToPng.ts`)

### 9.5 Export flow — DOCX
Client-side steps (`documentRenderer.ts`'s `exportDocDocx`):
1. For each diagram referenced by that document type, convert the already-rendered cached `<svg>`
   to a PNG data URL via `svgToPng.ts` (draws the SVG onto an offscreen `<canvas>`, then
   `canvas.toDataURL("image/png")`)
2. `POST /api/runs/{run_id}/diagrams` with `{architecture?, flowchart?}` PNG data URLs — this is
   the **only** point at which `architecture.png`/`flowchart.png` land on disk (server-side,
   `service.save_diagram_png` base64-decodes and writes them)
3. `POST /api/runs/{run_id}/export/{doc}` — server strips any `![...]  (architecture.png)` /
   `(flowchart.png)` reference whose file still doesn't exist (so export degrades gracefully
   instead of pandoc hard-failing), writes a temp `.export_<doc>.md`, shells out to `pandoc
   <file>.md -o <file>.docx`, deletes the temp file, and streams the resulting `.docx` back as a
   `FileResponse`
4. Frontend receives the blob and triggers a browser download

### 9.6 Styling
`globals.css` defines the entire design system as CSS custom properties on `:root` (colors,
spacing, radii), a light theme by default with a `prefers-color-scheme: dark` block, and hand-built
component classes (`.stat-tile`, `.card`, `.btn`, `.run-list`, `.sidebar-*`, `.tab-*`, etc.) — no
component library (no shadcn/MUI/etc.), Tailwind utility classes used alongside these for layout
(flex/grid/spacing) but not for the design system itself.

---

## 10. FastAPI backend — `webapp/`

### 10.1 `server.py` — routes only, no logic
```
GET  /api/form-schema              -> field list (name, kind) — single source of truth for the UI
POST /api/generate                 -> service.generate_from_form(form, auto_fields, excluded_sections)
POST /api/runs/{run_id}/revise     -> service.revise_run(run_id, change_request)
GET  /api/runs                     -> service.list_runs()
GET  /api/runs/{run_id}            -> service.load_run(run_id)  (404 if missing)
POST /api/runs/{run_id}/diagrams   -> service.save_diagram_png() for each of architecture/flowchart given
POST /api/runs/{run_id}/export/{doc} -> service.export_docx(run_id, doc) -> streams the .docx file
```
All exceptions are caught and re-raised as `HTTPException` with the original message as `detail`,
so the frontend always gets a real error message rather than a generic 500.

### 10.2 `service.py` — the business logic
- **`FORM_FIELDS`** — the (name, kind) list mirrored by the frontend's `formConfig.ts`. Excludes
  `assumptions` (system-managed, never a form input).
- **`CRITICAL_FIELDS`** = `{project_name, problem_statement, target_users, stakeholders}` —
  foundational identity fields; no context could invent these, so no auto-generate option exists
  for them in the UI.
- **`NEVER_EXCLUDABLE_FIELDS`** = `CRITICAL_FIELDS` plus every other structural section that, per
  the two reference example documents this project was originally built against
  (`BRD_Master_Tester_Agent_v4 1.pdf`, `TSD_Master_Tester_Agent_v4 2.pdf` in the repo root), was
  substantively populated in every real example — enforced server-side as a backstop regardless of
  what a raw API request claims.
- **`_ID_PREFIXES`** = `{objectives: "OBJ", functional_requirements: "BR", risks: "R"}` — the
  server assigns sequential ids (`OBJ-01`, `BR-01`, `R-01`, ...) to these list items; the user never
  types an id.
- **`normalize_form(form, excluded_sections)`** — builds the `partial_requirements_json` seed
  passed to the gap-filler agent. Every field copied through verbatim (auto_fields is a *separate*
  signal to the LLM about which fields to generate/enrich, never used here to clear anything — a
  field marked auto **with** existing content means "enrich this," not "wipe it and start over").
  Excluded fields are force-emptied here regardless of what the raw form happened to contain,
  clamped against `NEVER_EXCLUDABLE_FIELDS`.
- **`generate_from_form`** — normalizes the form, builds a **fresh** `build_gap_filler_agent()`
  pipeline via `build_document_pipeline`, runs it with `initial_state={partial_requirements_json,
  auto_fields}`.
- **`revise_run`** — loads the existing run's `requirements.json`, builds a fresh
  `build_revision_agent()` pipeline, runs it with `initial_state={requirements_json: existing}` and
  the change-request text as the message, and passes `parent_run_id=run_id` through to
  `run_pipeline_and_write` so lineage is recorded.
- **`_read_consistency_status`** — reads the first 400 chars of `consistency_report.md` and
  regex-matches `\bPASS\b` or `"no contradictions"` (case-insensitive) → `"pass"`, else `"issues"`,
  else `None` if the file doesn't exist. Mirrored independently in the frontend's
  `ConsistencyPanel` for a single run's own display.
- **`_read_run_meta`** / **`_aggregate_run_log`** — see Section 6 above; both treat every field as
  optional/nullable, never defaulting missing data to zero.
- **`list_runs()`** — the full directory scan described in Section 6.1; returns everything
  `dashboardStats.ts` and `RunCard`/`runTree` need per run.
- **`load_run(run_id)`** — reads one run's five document files + `requirements.json` +
  `consistency_report.md` off disk, returns `None` if `requirements.json` is missing.
- **`save_diagram_png(run_id, name, data_url)`** — decodes a `data:image/png;base64,...` string,
  writes `<name>.png` into the run folder.
- **`_find_pandoc()`** — looks on `PATH` first, then falls back to the default winget install
  location (`~/AppData/Local/Pandoc/pandoc.exe`) — a Windows-specific fallback.
- **`export_docx(run_id, doc)`** — see Section 9.5 step 3.

---

## 11. End-to-end request flow (webapp "New Request" path, concretely)

1. User opens `/new`, fills in some fields directly, ticks "Auto-generate/enrich" on others, leaves
   the rest blank, clicks **Generate Documents**.
2. `RequestForm` → `formLogic` assembles `{form, auto_fields, excluded_sections}` and validates that
   every `critical` field has content.
3. `apiGenerate()` → `POST /api/generate` → FastAPI `server.generate()` → `service.generate_from_form()`.
4. `normalize_form()` builds the partial requirements seed; sequential ids assigned to
   objectives/functional_requirements/risks.
5. A **fresh** pipeline is built: `build_document_pipeline(build_gap_filler_agent(), name="form_pipeline")`.
6. `run_pipeline_and_write()`:
   a. New `run_id` generated.
   b. `InMemorySessionService` creates a session (`session_id=run_id`) seeded with
      `{partial_requirements_json, auto_fields}`.
   c. `Runner.run_async()` drives the `SequentialAgent`:
      - `gap_filler_agent` reads the partial object + auto_fields list, calls Gemini with
        `output_schema=RequirementsModel`, writes the completed object to `requirements_json`.
      - The `ParallelAgent` fans out: `brd_agent`, `tsd_agent`, `flowchart_agent`,
        `architecture_agent`, `onepager_agent` all read `{requirements_json}` concurrently and each
        write their own markdown/mermaid text via their `output_key`.
      - `consistency_check_agent` reads all five outputs and writes `consistency_report`.
   d. Every LLM call along the way logs one line to `logs/<run_id>.jsonl` via the
      before/after/error callbacks.
   e. Final session state is read back; `write_state_outputs()` writes each present key to
      `output/<run_id>/<file>`; `write_run_meta()` writes `run_meta.json`.
7. The API response (full `RunResult`: run_id, requirements_json, documents, consistency_report) is
   returned to the frontend.
8. Frontend records the run in `localStorage` history and **navigates to `/runs/<run_id>`**.
9. `/runs/[runId]` fetches the run fresh via `GET /api/runs/{run_id}` (not reusing the POST
   response — a direct reload/shared-link visit must work identically), renders `<ResultsView>`,
   which mounts `DocumentRenderer` to parse Markdown, inline-render the two Mermaid diagrams, and
   wire up export/print/download buttons.

The chat flow (`adk web`) and the revision flow follow the identical
steps 6-9-equivalent, just with a different first-stage agent and message/seed.

---

## 12. Setup & run instructions (from a clean checkout)

### Backend
```bash
python -m venv .venv
.venv\Scripts\activate                      # Windows; `source .venv/bin/activate` elsewhere
pip install -r requirements.txt
```
Copy `.env.example` → `.env`, set `GOOGLE_API_KEY`.
Install `pandoc` system-wide (Windows: `winget install --id JohnMacFarlane.Pandoc`) if DOCX export
is needed.

### Frontend
```bash
cd frontend
npm install
```

### Run — Option A: the webapp (two processes, both required)
Terminal 1, from the repo root:
```bash
python -m uvicorn webapp.server:app --reload --port 8000
```
Terminal 2, from `frontend/`:
```bash
npm run dev
```
Open `http://localhost:3000/`. For a demo or non-dev use, prefer `npm run build && npm run start`
(faster, no dev overlays, avoids React dev-mode-only rendering quirks).

### Run — Option B: ADK's own chat UI (no frontend/Node needed at all)
```bash
adk web brd_agent_suite
```
Open the printed local URL, select `brd_agent_suite`, describe a project in prose.

### Verifying the model is still available
Since Gemini models get deprecated on a schedule (see `config.py`'s comment about
`gemini-2.5-flash` shutting down 2026-10-16), before relying on `MODEL_NAME` in a fresh setup, run a
quick `client.models.list()` against your own API key to confirm it's still live, and update
`config.py` if not — this is the single line that needs to change.

---

## 13. Current project state / progress

### Git history (4 commits on `main`, no other branches)
1. `911390b` — **"BRD generator v1"** — initial commit: the full `brd_agent_suite` agent system,
   `webapp/` as a *vanilla JS + static HTML* frontend (`webapp/static/{app.js, documents.js,
   form-config.js, index.html, styles.css}`, vendored `marked.min.js`/`mermaid.min.js`), served
   directly by FastAPI.
2. `636f885`, `1da3b30` — **"Updated"** — intermediate iterations (not individually detailed here;
   inspect `git show <hash>` if needed).
3. `38bb7ed` — **"Frontend updated"** — the vanilla-JS static frontend was **fully replaced** by
   the current Next.js app (`frontend/`); `webapp/static/` was deleted entirely; `webapp/server.py`
   became API-only (no more static file serving); the dashboard, sidebar layout, run history model,
   and revision flow were introduced in this pass.

### Uncommitted work in progress (as of this document)
`git status` shows modifications not yet committed:
- `brd_agent_suite/tools.py` (+45/-lines) — likely the `run_meta.json` / `parent_run_id` /
  duration-tracking additions described in Section 6.1/8.5 (confirm via `git diff` before
  committing).
- `webapp/service.py` (+94 lines) — the dashboard aggregation functions
  (`_read_consistency_status`, `_read_run_meta`, `_aggregate_run_log`, the enriched `list_runs()`
  fields) described in Section 10.2.
- `frontend/src/app/page.tsx` (+214/-lines) — the dashboard rewrite (stat tiles, charts, recent
  runs list) described in Section 9.1/9.3.
- `frontend/src/components/layout/Sidebar.tsx` (+51 lines) — the collapsible sidebar with
  localStorage-persisted collapsed state.
- `frontend/src/lib/types.ts` (+18 lines) — the `BackendRunSummary` fields backing the dashboard.
- `frontend/src/app/globals.css` (+50 lines) — styling for the above.

**New, not-yet-committed files** (`??` in git status):
- `frontend/src/app/history/page.tsx` — the History page (Section 9.1)
- `frontend/src/components/RunCard.tsx` — shared run-summary row component
- `frontend/src/components/dashboard/` — `ConsistencyMeter.tsx`, `CostByAgentChart.tsx`,
  `CostOverTimeChart.tsx`, `RunsPerDayChart.tsx`
- `frontend/src/lib/dashboardStats.ts` — all dashboard aggregation math (Section 9.3)
- `frontend/src/lib/runTree.ts` — parent/revision tree builder (Section 9.1)

**In short: the dashboard analytics (stat tiles, charts, cost/consistency tracking) and the
History tree view are a complete, working feature that simply hasn't been committed to git yet.**
To persist this progress, run `git add -A && git commit` (or ask Claude Code to do it) before doing
anything that could discard working-directory changes.

### Reference materials in the repo root (not part of the running app)
- `BRD_Master_Tester_Agent_v4 1.pdf`, `TSD_Master_Tester_Agent_v4 2.pdf`,
  `Executive_OnePager_MTA 1.docx`, `TSD_Kantata_Dashboard_Teams_Agent_v0_1.docx` — example/reference
  documents this system's prompts and the "always-populated section" rules in
  `NEVER_EXCLUDABLE_FIELDS` were originally derived from. Useful context if tuning prompt output
  quality later, but not consumed programmatically anywhere.

---

## 14. Key design decisions worth remembering if rebuilding

1. **One schema, five renderers.** Never let a document-generator prompt invent its own idea of the
   input shape — everything reads the identical `RequirementsModel` JSON, which is why the
   consistency-check step rarely finds *structural* contradictions, only content-level ones.
2. **File-per-run, no index.** Deliberately avoided a database. The run directory listing is the
   query. This trades query flexibility for zero infra and total transparency (you can `cat` any
   run's files directly).
3. **Fresh agent trees per request, one singleton for chat.** Driven entirely by ADK's single-parent
   constraint — not a stylistic choice, a hard requirement once you understand `build_*()` factories.
4. **Diagrams are text (Mermaid), not images, until export.** Keeps the backend free of any
   rendering dependency; the tradeoff is the two-step export dance (render SVG client-side → PNG →
   upload → THEN embed in DOCX).
5. **Every optional/instrumentation field is nullable, never defaulted to zero.** Applies to
   `duration_seconds`, `total_tokens`, `estimated_cost_usd`, `cost_by_agent`, `parent_run_id`
   throughout both backend and frontend — a run predating some instrumentation must read as
   "unknown," not "zero," everywhere it's aggregated.
6. **The dashboard's estimated fallback values are seeded-random, not live-random** — specifically
   so a page reload doesn't reshuffle old runs' numbers on every render, while still not lying about
   which values are real vs. estimated (the underlying per-run API data is never mutated).
