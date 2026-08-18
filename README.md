# BRD/TSD/Diagram/One-Pager Generation Agent

A multi-agent system (Google ADK + Gemini) that turns a project description into five documents: a
BRD, a TSD, a Mermaid flowchart, a Mermaid architecture diagram, and an executive one-pager.

There are two ways to use it:
- **`adk web`** — a free-text chat interface. Describe your project in prose; the agent asks batched
  clarifying questions if critical info is missing, otherwise generates straight away.
- **The structured-form webapp** (`webapp/`) — a form with a field for everything the documents need,
  per-field "auto-generate / enrich" toggles, live diagram rendering, DOCX export, print-to-PDF, and an
  iterative "request a change" flow that regenerates as a new versioned run.

## One-time setup

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

## Running — Option A: the structured-form webapp (recommended)

From the project root:

```bash
python -m uvicorn webapp.server:app --port 8010
```

Open **http://127.0.0.1:8010/** in a browser. Fill in what you know, leave the rest blank (or type a
few bullet points and tick "Auto-generate / enrich" to have the AI flesh them out), and click
**Generate Documents**.

A few fields — Project Name, Problem Statement, Stakeholders, Target Users, and Functional
Requirements — have no auto-generate option and must be filled in directly; everything else can be
generated or enriched by the AI.

From the results view you can switch between the five documents, download any of BRD/TSD/One-Pager as
a `.docx` (diagrams get embedded as real images), use your browser's Print dialog to save any document
as a PDF, download a diagram as a standalone PNG, or type a follow-up change request to regenerate a
new revision without losing the original run (previous runs stay reachable from the "Load a previous
run" dropdown, kept in your browser's local storage).

Use `--reload` instead of a bare `--port` while making backend changes, e.g.
`python -m uvicorn webapp.server:app --reload --port 8010` (the frontend's static files are always
picked up fresh on a page refresh either way).

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

## Architecture

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

All three flows funnel into the same `pipeline.build_document_pipeline()` factory and share the five
generator prompts — only the first stage differs. See `brd_agent_suite/schema.py` for the shared
requirements schema, `brd_agent_suite/rubric.py` for the chat flow's completeness rubric, and
`webapp/service.py` for the form flow's field list and normalization.

## Model

The working model is centralized in `brd_agent_suite/config.py` (`MODEL_NAME`). It currently defaults to
`gemini-3.7-flash`. Note: `gemini-2.5-flash` (the spec's original suggested default) is scheduled for
shutdown 2026-10-16 on the Gemini Developer API — if you need to pin a different model, verify its
availability first with `client.models.list()` against your own API key.

## Diagram rendering and export — how it actually works

Diagrams are rendered **client-side** in the browser via a locally-vendored `mermaid.js`
(`webapp/static/vendor/`) — no CDN, no server-side headless browser, no Node/`mmdc` dependency. To
embed a diagram in a DOCX export, the browser converts the already-rendered SVG to a PNG via
`<canvas>` and uploads it to `POST /api/runs/{run_id}/diagrams` before requesting the export; `pandoc`
(installed system-wide via winget) then does the Markdown → DOCX conversion. PDF export has no server
involvement at all — it's the browser's native Print dialog against a print-optimized view.

If you need a diagram PNG or a DOCX outside the webapp, `pandoc` is still available on this machine for
manual `pandoc BRD.md -o BRD.docx` conversions (diagrams won't be embedded unless the referenced
`architecture.png`/`flowchart.png` already exist in the same folder).
