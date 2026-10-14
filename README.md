# BRD/TSD/Diagram/One-Pager Generation Agent

A multi-agent system (Google ADK + Gemini) that turns a project description into five documents: a
BRD, a TSD, a Mermaid flowchart, a Mermaid architecture diagram, and an executive one-pager.

There are two ways to use it:
- **`adk web`** — a free-text chat interface. Describe your project in prose; the agent asks batched
  clarifying questions if critical info is missing, otherwise generates straight away.
- **The webapp** (`frontend/` + `webapp/`) — a dashboard listing every run, a form with a field for
  everything the documents need (with per-field "auto-generate / enrich" toggles), live diagram
  rendering, DOCX export, print-to-PDF, and an iterative "request a change" flow that regenerates as
  a new versioned run.

## One-time setup

### Backend

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt
```

Copy `.env.example` to `.env` and fill in your Gemini API key (get one at
https://aistudio.google.com/apikey):

```
GOOGLE_API_KEY=your-key-here
```

Download the company font (Satoshi) once — it's used by the DOCX export and the document preview:

```bash
python -m webapp.branding.fonts
```

The font files are deliberately not in git: Satoshi's licence (ITF Free Font License) forbids
redistributing them from a public repo, so this fetches them straight from Fontshare into
`webapp/branding/fonts/` and `frontend/public/fonts/` (both gitignored). The Dockerfiles do the same
at build time. Without them everything still works, just in a fallback font.

### Frontend

Only needed for Option A below (`adk web` alone doesn't need Node at all):

```bash
cd frontend
npm install
```

## Running — Option A: the webapp (recommended)

This is two processes: the FastAPI backend (the API — document generation, run storage) and the
Next.js frontend (the UI), which proxies `/api/*` requests to the backend. Both need to be running.

**1. Backend** — from the project root:

```bash
python -m uvicorn webapp.server:app --port 8000
```

Add `--reload` while actively editing backend code:
`python -m uvicorn webapp.server:app --reload --port 8000`.

**2. Frontend** — in a second terminal, from `frontend/`:

```bash
npm run dev
```

Open **http://localhost:3000/**. Dev mode hot-reloads on save.

For a demo, or any time you're not actively editing frontend code, use a production build instead —
it's noticeably faster, drops all dev-only overlays, and avoids some React dev-only-mode rendering
quirks (harmless, but unnecessary to risk live):

```bash
npm run build
npm run start
```

By default the frontend expects the backend at `http://127.0.0.1:8000` (see `next.config.ts`); to
point it elsewhere, copy `frontend/.env.local.example` to `frontend/.env.local` and set
`BACKEND_URL`.

### Using it

The **dashboard** (`/dashboard`) lists every run that's ever been generated — by this UI or by `adk
web`/`adk run` directly, since both write to the same `brd_agent_suite/output/` directory — with
stats and a searchable recent-runs list. Click **New Request** to open the form (or **Fill Demo
Data** on that page to instantly populate a complete, realistic example — handy for a quick demo),
fill in what you know, leave the rest blank (or type a few bullet points and tick "Auto-generate /
enrich" to have the AI flesh them out), and click **Generate Documents**.

A few fields — Project Name, Problem Statement, Stakeholders, Target Users — have no auto-generate
option and must be filled in directly; everything else can be generated or enriched by the AI.

### Starting from a domain template

**New Request** opens on **Start from template**, a gallery like Word's File → New:

- **Blank** opens the empty form. A dialog first asks for the project's domain (optional): pick one
  from the list, or choose **Other** and type it. The domain is recorded on the run. If the domain has
  a published template, its guidance helps the AI with any section you ask it to auto-generate.
- **A template card** (e.g. Healthcare) opens a preview. It shows what the template pre-fills, the
  source of each item, and applicability questions such as "Will the system handle payment card
  data?". Items linked to a question are only added when it's ticked.

Each template item appears in its form field as a suggestion with **Accept** and **Remove** buttons.
Editing an item also counts as accepting it. **Generate Documents** stays disabled until every item
has been reviewed. The backend checks this too: a request that leaves any item undecided is rejected
with 422. The run records the template version and what happened to each item, so later versions can
learn from what users accept, edit and remove.

Items are tagged **Regulatory** (required by a named law, regulation or mandatory standard) or
**Best practice**, and each one names its source. The starter Healthcare and Financial Services content
is US-focused, and every item was checked against official sources. The item-by-item evidence is in
[webapp/doc_templates/starter/SOURCES.md](webapp/doc_templates/starter/SOURCES.md).

**Template Studio** (`/admin/templates`, admins only) is where templates are created and edited:
- **Drafts and publishing.** Each template has one editable draft. Publishing turns that draft into a
  new version that is never changed again.
- **Restoring.** Restoring an older version copies it into the draft.
- **Retiring.** Retiring a template hides it from users; reactivating it brings it back.
- **Domains.** The **Domains** tab manages the dropdown list. Domains can be hidden but not deleted.

None of this deletes anything, and there are no DELETE endpoints.

**One-time setup.** This creates the three template tables, the starter domain list, and the starter
templates as **unpublished drafts**. It only adds things: existing tables, domains and templates are
skipped, never changed.

```bash
python -m webapp.scripts.setup_templates          # dry run: shows what it would do
python -m webapp.scripts.setup_templates --apply  # does it
```

Then open Template Studio, review each starter draft, and publish it.

### Starting from documents instead of the form

On **New Request**, the **Upload documents** tab takes 1–5 project documents (PDF, DOCX, TXT, or MD;
up to 15 MB each and 30 MB in total), such as an SOW, a proposal, or meeting notes. Then:

1. **Parse locally, for free.** TXT and MD files are decoded, DOCX goes through pandoc, and PDFs with
   a text layer go through pypdf. Only a scanned PDF is sent to Gemini as the file itself.
2. **Extract.** A single Gemini call (`document_extraction_agent`) fills the form. Every value comes
   with the exact quotes it was taken from. If the documents are too long for one call, each document
   is extracted on its own and the results are merged.
3. **Review.** Plain code, not the LLM, checks every quote against the source text and puts each field
   into one of four states:
   - **needs your input**: a critical field that's missing or vague (Project Name, Problem Statement,
     Stakeholders, Target Users, Functional Requirements).
   - **please check**: inferred, low confidence, contradicted between documents, or its quote couldn't
     be found in the source.
   - **AI will draft**: a non-critical gap.
   - **from your documents**: stated clearly, with a verified quote.

   The review page at `/new/review/<extraction_id>` asks a specific question for each critical gap,
   with suggested answers taken from the documents. **Generate Documents** stays disabled until every
   "needs your input" and "please check" item is resolved. **Add another document** re-extracts from
   all the files together and keeps your edits.
4. **Generate.** The existing form pipeline runs on the reviewed form. The documents' text is passed
   to the gap filler as grounding for the fields the AI drafts.

Extraction and generation run as background jobs. The browser polls `GET /api/jobs/<id>`, which
reads only process memory and never Databricks, so the SQL warehouse can still auto-stop. Uploaded
files, their parsed text, and the review payload are stored under the project as `SOURCE_DOCUMENT`,
`SOURCE_TEXT`, and `SOURCE_EXTRACTION` documents. The extraction's cost goes in `generation_runs`
with `generation_type = document_extraction`.

**Deployment note:** job state is held in memory. Run the backend Container App with
**max replicas = 1** (or enable session affinity), so that polls reach the replica running the job.
Each user can upload `DOC_UPLOADS_PER_DAY` times per day (default 10; admins are exempt).

Each run gets its own page at `/runs/<run_id>` (bookmarkable/shareable) where you can switch between
the five documents, download any of BRD/TSD/One-Pager as a `.docx` (diagrams get embedded as real
images), use your browser's Print dialog to save any document as a PDF, download a diagram as a
standalone PNG, or type a follow-up change request to regenerate a new revision without losing the
original run.

## Running — Option B: the `adk web` chat interface

```bash
adk web brd_agent_suite
```

Open the printed local URL, pick `brd_agent_suite`, and describe a project. The agent will either ask
up to three batched clarifying questions (if critical information is missing) or proceed straight to
generation, flagging any assumptions it made along the way.

## Output

Every run (from either interface) lands in `brd_agent_suite/output/<run_id>/`:
- `requirements.json` — the structured requirements object every document was generated from
- `BRD.md`, `TSD.md` — the two main documents (each embeds the diagrams as `![...](architecture.png)` /
  `![...](flowchart.png)` references — those PNGs only exist on disk after a DOCX export from the
  webapp uploads them, since diagrams are rendered client-side, not on the server)
- `flowchart.mmd`, `architecture.mmd` — raw Mermaid diagram source
- `Executive_OnePager.md` — the leadership summary
- `consistency_report.md` — cross-document contradiction check
- `BRD.docx` / `TSD.docx` / `Executive_OnePager.docx` — only present once exported from the webapp

`GET /api/runs` lists every run directory that has a `requirements.json` — this is what powers the
dashboard, and is genuinely everything on disk, not something tracked separately.

## Architecture

```
                              ┌─ extraction_agent    (chat flow: free prose -> structured JSON)
first stage, one of ─────────┼─ gap_filler_agent     (form flow + document flow: completes/enriches marked fields)
                              └─ revision_agent       (revise flow: applies a change request)

(document flow: document_extraction_agent fills the form for the user to review first; it runs
 on its own, before the pipeline, not as a first stage)
                                        │
                                        ▼
                         ParallelAgent: brd_agent, tsd_agent, flowchart_agent,
                                        architecture_agent, onepager_agent
                                        │
                                        ▼
                              consistency_check_agent  (flags contradictions across all five)
```

All three flows funnel into the same `pipeline.build_document_pipeline()` factory and share the five
generator prompts — only the first stage differs. See `brd_agent_suite/schema.py` for the shared
requirements schema, `brd_agent_suite/rubric.py` for the chat flow's completeness rubric, and
`webapp/service.py` for the form flow's field list and normalization.

## Model

The working model is centralized in `brd_agent_suite/config.py` (`MODEL_NAME`). It currently defaults to
`gemini-3.7-flash`. Note: `gemini-2.5-flash` (the spec's original suggested default) is scheduled for
shutdown 2026-10-16 on the Gemini Developer API — if you need to pin a different model, verify its
availability first with `client.models.list()` against your own API key.

## Frontend

`frontend/` is a Next.js (App Router, TypeScript, Tailwind CSS) app — API-only calls to the FastAPI
backend, no server-side data fetching of its own. Structure:
- `/` — public landing page (open to everyone, signed in or not)
- `/dashboard` — dashboard (stats + recent runs, from `GET /api/runs`)
- `/new` — the request form
- `/runs/[runId]` — a single run's results (documents, diagrams, revise, export)
- `src/lib/documentRenderer.ts` — the tab/diagram rendering engine (Markdown → HTML via `marked`,
  Mermaid diagrams rendered in place of the `architecture.png`/`flowchart.png` placeholders, cached
  `<svg>` nodes reused for PNG/DOCX export)
- `src/lib/formConfig.ts` / `formLogic.ts` — the form's field definitions and validation, mirroring
  `webapp/service.py`'s `FORM_FIELDS` on the backend
- `next.config.ts` — the `/api/*` → backend rewrite (with a bumped proxy timeout, since generation
  can take 30-90s) and the dev-origin allowlist

## Diagram rendering and export — how it actually works

Diagrams are rendered **client-side** in the browser via the `mermaid` npm package (no CDN, no
server-side headless browser, no Node/`mmdc` dependency on the backend).

**Fitting diagrams to A4 portrait pages** (`frontend/src/lib/diagramLayout.ts`). Without changing
anything a diagram says, the browser:

1. lays a flowchart out both top-down and left-right, and keeps whichever reads better on a portrait
   page (the preview uses the same choice);
2. scales it to the page width, but never so far that labels drop below 9pt;
3. redraws a top-down flowchart that's still taller than a page as one flowchart per page, joined by
   lettered off-page connector circles (a step at the bottom of one page points to (A); the next
   page starts from (A)), captioned "part i of n" (`frontend/src/lib/flowchartPages.ts`). Pages are
   rebuilt from mermaid's own parse of the diagram and filled with as many rows as actually fit,
   measured by rendering each page; before use, the pages are parsed back and checked to contain
   exactly the original steps and links. Anything that can't be redrawn that way (e.g. subgraphs)
   is instead cut into page-sized image slices through empty space between rows;
4. for a diagram too wide to read at page width, shows a whole-diagram overview (rendered sharp enough
   to zoom into on screen), followed by readable detail sections when those take four pages or fewer.

**DOCX export.** The browser uploads each diagram's full-size PNG to `POST /api/runs/{run_id}/diagrams`
(kept with the run), then sends the page-sized parts with `POST /api/runs/{run_id}/export/{doc}`.
`webapp/branding/docx_export.py` sizes each image to its page, runs `pandoc` with the company reference
doc, and embeds the Satoshi fonts into the result so it looks right on machines without Satoshi.

**Company formatting** lives in `webapp/branding/intuitive_reference.docx`: A4 portrait, Satoshi on a
4pt type scale (12/16/24/32pt) with Regular/Medium/Bold for hierarchy, headings in #003AE3, logo top
left in the header, page number bottom right. It's generated — edit
`webapp/branding/build_reference_docx.py` (or `logo.png`) and rerun
`python -m webapp.branding.build_reference_docx`; a test fails if the committed file is stale. The
preview and print styles in `frontend/src/app/globals.css` mirror it.

**PDF** has no server involvement — it's the browser's Print dialog against a print view laid out like
the DOCX (A4, logo header, page numbers in Chrome/Edge 131+, same diagram parts).

If you need a DOCX outside the webapp, `pandoc` is still available for manual conversions — add
`--reference-doc webapp/branding/intuitive_reference.docx` for the company formatting (diagrams won't
be embedded unless the referenced `architecture.png`/`flowchart.png` already exist in the same folder).
