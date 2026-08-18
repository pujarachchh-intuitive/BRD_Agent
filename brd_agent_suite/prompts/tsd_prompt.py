TSD_INSTRUCTION = """You write a Technical Specification Document. It is the companion to the BRD already
generated from the same source data — its job is to specify HOW the system is built: components,
integration patterns, data flow, interface contracts, security enforcement, deployment, and operations.
Precise, load-bearing language. Every derived value gets an actual formula or pseudocode, not a
description of one. Every genuinely unconfirmed detail is marked "placeholder pending discovery" rather
than invented with false confidence.

SOURCE DATA (the single source of truth — same object the BRD was generated from):
{requirements_json}

SECTION OMISSION: if requirements_json.excluded_sections names a field, or a subsection's only data
source is empty for any other reason, omit that section/subsection (heading, prose, table) completely
— never render it with "N/A" or an empty table. This OVERRIDES an [ALWAYS] tag when that tag's section
is driven by the excluded field specifically (section 10 by non_functional_requirements, section 13 by
risks) — the user's explicit exclusion wins. It does NOT apply to composite sections built from many
fields at once (1, 2, 8, 9, 11, 12, 14) — those stay regardless, they just have less to say. Within
section 3, subsection 3.2 (Components) can be omitted alone if system_components is empty/excluded,
without touching 3.1/3.3/3.4. After any omission, renumber remaining top-level sections sequentially
with no gaps, and use each section's ACTUAL number in this rendering wherever these instructions
reference one by number.

ADDITIONAL SECTIONS: if requirements_json.additional_sections is non-empty, add one more numbered
top-level section per entry, placed after all the sections below (i.e. after Appendix if present, or
after the last section you actually include), titled exactly as that entry's `title`, with its
`content` as the section body, formatted into paragraphs or bullets as fits without changing its
meaning.

Write the TSD in Markdown with this section structure. Use whichever subsections actually fit this
project (skip a subsection cleanly if it doesn't apply, e.g. skip Data Model if this isn't data-heavy) —
but the sections marked [ALWAYS] are non-negotiable in every TSD you produce, subject to the SECTION
OMISSION rule above.

---

# TECHNICAL SPECIFICATION DOCUMENT
## <the project's name, written directly from the source data>

A document-control table: Version 1.0 | Date "[Date]" | Author "[Author]" | Status "Draft — for review" |
Reference "Companion to BRD-<doc_id_acronym from the source data, used verbatim>-001".

## 1. Purpose, Scope, and Status [ALWAYS]
State what this document specifies (the how) versus its companion BRD (the what). If — and only if —
the source data contains something genuinely easy to misread (a phased scope, a hard dependency, a
deferred-vs-excluded distinction, an assumption a reader could mistake for a confirmed fact), add a short
subsection "A warning the reader must not skip" naming it plainly. Do not invent drama here if nothing in
the source data actually warrants it — an empty warning box is worse than none.

## 2. Requirement Traceability (BRD → TSD) [ALWAYS]
A table: BRD ID | Technical Requirement(s) | Phase. You must invent technical requirement IDs using the
convention "TR-<n>.<m>" grouped by subsystem (e.g. all registry-related technical requirements are
TR-1.x, all evaluation-related are TR-4.x — pick your own subsystem numbering, but be internally
consistent throughout the rest of the document). EVERY SINGLE functional_requirements[].id from the
source data must appear as a row in this table, mapped to at least one TR- id, with its timeline_phases
phase noted. This is the single most important mechanical link in this document — do not leave any
functional requirement ID untraceable.

## 3. Architecture [ALWAYS]
### 3.1 Logical architecture
A prose description of the system derived from system_components and data_flow_steps, written as if
captioning the figure immediately below it. Then, on its own line, insert exactly this image reference:
`![Figure 1 — Architecture](architecture.png)`
Do NOT draw your own ASCII-art or ad-hoc text diagram — the real diagram is inserted via that image
reference, so a second hand-drawn one would be redundant.
### 3.2 Components
A table: ID (C-01, C-02, ...) | Component | Responsibility | Technology — one row per system_components
entry, technology inferred from tech_stack_preferences.
### 3.3 The load-bearing architectural rule
State, in one or two sentences, THE single principle the whole design depends on — the one rule that, if
violated, breaks the architecture (e.g. "metric logic exists in exactly one place," "nothing writes back
to the source system," "every adapter speaks the same versioned protocol"). Find the real one implied by
this project's constraints and system_components — do not write a generic platitude. State plainly what
a code reviewer should reject if they see it violated.
### 3.4 Data flow
A numbered table: Step | From | To | Mechanism | Frequency — derived directly from data_flow_steps, made
concrete (name real mechanisms and frequencies consistent with tech_stack_preferences and
non_functional_requirements, marking anything unconfirmed as "[TBD]"). After the table, on its own line,
insert exactly this image reference: `![Figure 2 — Process Flow](flowchart.png)`

## 4. Environments [if relevant]
A table: Environment | Source | Purpose — Development/Test/Production or an equivalent split fitting
this project.

## 5. Source/System Integration [if the project integrates with an external system — from integrations]
Authentication approach, API/access method, an object/field mapping table (mark anything genuinely
unconfirmed as "placeholder pending discovery," never invent fake certainty), extraction cadence, and a
rate/cost budget note.

## 6. Data Model [if data-heavy]
Layers (raw/staging/core/aggregate or equivalent), dimensions, facts, bridge tables if any, aggregates.
End with an explicit "Excluded by construction" note: name anything deliberately never captured (a
sensitive field dropped at ingestion, never filtered downstream) if the source data implies one exists.

## 7. Core Logic / Metric Implementation [if the project computes derived values]
For each calculated/derived value implied by functional_requirements or success_metrics: show the actual
computation (formula or pseudocode), state the correct behavior for undefined/edge cases explicitly
(e.g. "returns NULL, never 0, when the denominator is undefined"), and note what upstream item it
depends on.

## 8. Interface Specifications [ALWAYS, at whatever depth fits]
An endpoint/contract table: Method | Path | Returns. A response envelope shape if one fits this project.
A numbered list of interface specifications covering: auth requirements, pagination, versioning policy,
error format, and — critically — where request-scope is resolved. State explicitly: a scope or
permission-relevant filter must NEVER be accepted as a trusted client parameter; it is always resolved
server-side from the authenticated identity. Make this its own numbered item, not a buried clause.

## 9. Security and Privacy [ALWAYS]
Authentication, authorization, audit logging. If any field-level sensitivity is implied by the source
data (scope_permanently_excluded, non_functional_requirements, or constraints), name the INDEPENDENT
layers of enforcement (e.g. "excluded at the permission-set level AND dropped at ingestion AND never in
the API contract") — enforcement should never rely on a single layer. Cover network/secrets handling.

## 10. Non-Functional Requirements [ALWAYS]
Technical translation of each non_functional_requirements entry, each tagged with its delivery phase
(from timeline_phases) if phasing applies. Table: Category | Requirement | Phase.

## 11. Testing [ALWAYS]
Test levels (unit/integration/contract/end-to-end/security/performance — whichever fit). Explicitly call
out anything that functions as a RELEASE GATE (must pass before ship, not a nice-to-have check) — label
it as such in its own line, don't bury it in a table cell.

## 12. Deployment and Operations [ALWAYS]
CI/CD integration, observability (a signal/alert-condition table), runbook basics, disaster recovery if
relevant to this project's data/state model.

## 13. Technical Risks [ALWAYS]
A table: ID (TR-RISK-01, ...) | Risk | Impact (High/Medium/Low) | Mitigation — technical risks distinct
from (but may cross-reference) the BRD's business risks. Derive from risks plus any technical risk
implied by system_components/integrations/constraints not already captured there.

## 14. Assumptions, Dependencies, and Open Questions [ALWAYS]
Pull from assumptions, dependencies, and open_questions, adding any additional technical-only open
question the architecture itself raises.

## 15. Appendix [if the project has structured internal data]
Example JSON objects for any structured entity the system passes around internally, consistent with the
schema style already used for functional_requirements/risks in the source data.

---

Tag every technical requirement you invent with its delivery phase (or "Future Scope") exactly as the
source data's timeline_phases imply — the BRD and TSD phasing must agree; do not introduce a phase name
that doesn't correspond to one in timeline_phases (or note explicitly if something is Future Scope beyond
the given phases).
"""
