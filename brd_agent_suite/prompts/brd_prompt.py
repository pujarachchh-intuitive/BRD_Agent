BRD_INSTRUCTION = """You write a Business Requirements Document that matches the structure, tone, and rigor of a
professional enterprise BRD — not a generic template. Plain, direct language. State the problem before the
solution. Every claim about scope, priority, or measurement must be concrete, never vague ("improve performance"
is not acceptable; "P95 API latency under 500ms" is).

SOURCE DATA (the single source of truth — do not invent facts that contradict it):
{requirements_json}

SECTION OMISSION: if requirements_json.excluded_sections names a field, or a section's only data
source is empty for any other reason, omit that entire section or subsection (heading, prose, and
table) completely — never render it with "N/A" or an empty table. After omitting, renumber every
remaining top-level section so numbering stays sequential with no gaps, and if any instruction below
references another section by a fixed number, use that section's ACTUAL number in this rendering
instead. Sections 1 (Purpose), 2 (Objectives), 4 (Detailed Requirements), and Sign-Off are NEVER
omitted — their backing fields are always populated by design. scope_deferred backs BOTH subsection 3.2
and section 10 (Future Scope): if it's empty/excluded, omit both together, not just one.

ADDITIONAL SECTIONS: if requirements_json.additional_sections is non-empty, add one more numbered
top-level section per entry, placed after all the sections below but still before Sign-Off (Sign-Off
always stays last), titled exactly as that entry's `title`, with its `content` as the section body,
formatted into paragraphs or bullets as fits without changing its meaning.

Write the BRD in Markdown with EXACTLY this section structure, in this order:

---

# BUSINESS REQUIREMENTS DOCUMENT
## <the project's name, written directly from the source data's project_name field — do not use template syntax, write the literal name>

A document-control table:
| Field | Value |
|---|---|
| Document ID | "BRD-<doc_id_acronym from the source data, used verbatim>-001" |
| Version | 1.0 |
| Date | Use today's date if known from context, otherwise write "[Date]" |
| Author | "[Author]" |
| Status | "Draft — pending stakeholder review" |
| Scope of this document | One line naming which phases/parts this document covers |
| Target platforms | Derived from tech_stack_preferences / system_components |
| Reference | "[Reference/supersedes — none for v1.0]" |

### Top Five Features
A table: # | Feature | The question it answers | Section.
Pick the five most important functional_requirements (by priority, M first) and group them into five
named features. For "The question it answers," phrase it as the literal question a stakeholder would ask
— never a restated description (e.g. "Is every requirement in this solution's BRD/TSD actually covered by
a test, and did it pass?" not "Provides traceability"). Point to the section number where each is detailed.

## 1. Purpose
2–3 tight paragraphs, plain language. State the problem (problem_statement, business_context) before
describing that this document scopes the solution. Do not describe the solution's features here — only
the problem and what this document is about.

## 2. Objectives
A table: ID | Objective | Success measure — one row per item in objectives. Every row must have a
measurable success_measure already provided; do not soften it into a vague description.

## 3. Scope
### 3.1 In scope
Bullet list from scope_in.
### 3.2 Explicitly deferred
Bullet list from scope_deferred, each bullet as "Item (why_deferred)". Note explicitly that these are
candidates for a later phase — see Future Scope (section 11 below, renumber if your document differs).
### 3.3 Permanently excluded (not a phasing decision)
Bullet list from scope_permanently_excluded. Add one sentence making explicit that this is NOT the same
as deferred — these will not happen regardless of phase.

## 4. Detailed Requirements
Group functional_requirements into 2–4 sensible capability areas based on their content (invent
reasonable group names from the requirement descriptions — e.g. "Registry & Ingestion," "Evaluation
Engine"). For each group, a table: ID | Requirement | Priority (M/S/C). Do not renumber the IDs — use
them exactly as given in the source data.

## 5. Solution Approach
### 5.1 Process Flow
One paragraph describing the end-to-end flow a request/record moves through, derived from
data_flow_steps, written as if captioning the figure immediately below it. Then, on its own line,
insert exactly this image reference so the real rendered diagram lands here:
`![Figure 1 — Process Flow](flowchart.png)`
Do NOT draw your own ASCII-art or ad-hoc text diagram — the real diagram is inserted via that image
reference, so a second hand-drawn one would be redundant.
### 5.2 Architecture
One paragraph describing the architecture as a pipeline/system derived from system_components and
data_flow_steps, written as if captioning the figure immediately below it. Then, on its own line, insert
exactly this image reference so the real rendered diagram lands here: `![Figure 2 — Architecture](architecture.png)`
Do NOT draw your own ASCII-art or ad-hoc text diagram — the real diagram is inserted via that image
reference, so a second hand-drawn one would be redundant.
### 5.3 Proposed Technology Stack
A table: Layer | Proposal | Notes — derived from tech_stack_preferences and system_components. The Notes
column must justify each choice (why this technology, not just what it is), the same way a real
architecture decision record would.
### 5.4 Design Principles
3–6 bullets — durable principles this design commits to (e.g. what never happens, what's never
rebuilt-from-scratch, what's always true). Derive from constraints and the overall shape of the solution;
do not restate the requirements list.

## 6. Non-Functional Requirements
Group non_functional_requirements under category headers (Performance, Scalability, Reliability,
Security, Auditability, Extensibility — use whichever categories are actually present in the source data).

## 7. Risks
A table: ID | Risk | Impact (High/Medium/Low) | Mitigation — one row per item in risks.

## 8. Delivery Phases
A table: Phase | Content | Exit Criteria — one row per item in timeline_phases. After the table, one
sentence noting which phases depend on which (infer from ordering and content if not explicit).

## 9. Open Questions
Bullet list from open_questions. These must be genuinely unresolved items, not rhetorical.

## 10. Future Scope (Deferred, Not Rejected)
A table: Item | What it would unlock | What it would require — derived from scope_deferred (add a
"what it would require" column inferred from the item's nature since scope_deferred may not specify it).
One line before the table stating nothing here is committed, estimated, or approved.

## 11. Sign-Off
A table: Role | Name | Signature | Date — rows for Executive Sponsor, and 1-2 other roles inferred from
stakeholders, all left blank as placeholders.

---

Every functional_requirements[].id from the source data MUST appear somewhere in section 4 — do not
drop any. Do not add requirements that aren't in the source data. Do not fabricate names, dates, or
numbers not present in or reasonably inferable from the source data — use "[TBD]" placeholders instead,
consistent with any items already in assumptions/open_questions.
"""
