ONEPAGER_INSTRUCTION = """You write a one-page executive summary for leadership approval. This is a fixed
template — follow it exactly, section for section, in this order. Terse, plain language. No jargon that
wasn't already in the source data. Every section should read like it was written for someone who will
read this once, in under two minutes, before a meeting.

SOURCE DATA:
{requirements_json}

The intended audience for THE ASK is: use decision_audience from the source data.

Write in Markdown with EXACTLY this structure:

---

# <the project's name, written directly from the source data>
One line: a plain-language tagline capturing the value in under 15 words.

## WHY
2-3 sentences: the problem, from problem_statement / business_context. No solutioning here.

## WHAT WE WILL DELIVER
A numbered list, 1-2 items, of the highest-level deliverables (roll up functional_requirements into 1-2
big buckets — do not list every requirement).

## WHAT <AUDIENCE> GETS
Replace <AUDIENCE> with a short label derived from decision_audience (e.g. "LEADERSHIP GETS",
"THE BUSINESS GETS"). A small grid — present as a table or a tight bullet list of 4-6 named capability
pillars, each with a one-line description. Derive the pillars from functional_requirements /
success_metrics, naming each pillar like a product feature, not a requirement ID.

## HOW IT FITS TOGETHER
A short arrow-chain description of the data/architecture flow, derived from data_flow_steps /
system_components (e.g. "Source → Processing → Output → Dashboard"). One or two sentences after the
chain explaining the one thing that makes this maintainable/extensible (pull from constraints or the
TSD's spirit — e.g. "one protocol serves every adapter, so adding a new type is a plugin, not a
redesign"). After that, on its own line, insert exactly this image reference:
`![Architecture](architecture.png)`

## QUESTIONS IT WILL ANSWER
Bullet list, phrased as literal questions a stakeholder would ask, derived from the functional
requirements and objectives (e.g. "Which requirements have no test coverage at all" not "Provides
coverage visibility").

## WHAT IT DELIBERATELY EXCLUDES
Bullet list from scope_deferred and scope_permanently_excluded combined. Each bullet must include the
one-line REASON the exclusion is a good idea (keeps scope/review/privacy/timeline small) — never just
state the exclusion alone.

## HOW WE WILL DELIVER IT
A compact horizontal layout: one heading per phase (PHASE 0, PHASE 1, ...) from timeline_phases, each
with one line of content underneath. After the phases, one sentence noting any hard dependency between
them (e.g. "Phases 2 and 3 both depend on Phase 1").

## DECISIONS WE NEED FROM LEADERSHIP
A table: Decision | Owner | Why it matters now. Derive 3-5 real decisions from open_questions,
dependencies, and constraints — phrase each as an action ("Approve X," "Confirm Y," "Name Z") not a
restated open question.

## RISKS WE ARE MANAGING OPENLY
2-4 of the risks from `risks` that a leader would actually worry about (not every risk in the source
data — pick the highest-impact, most leadership-relevant ones). Format each as: a bolded one-line fear,
then one plain-language mitigation sentence underneath. No impact/likelihood rating here — that's the
BRD's job, not this document's.

## THE ASK
One bold, specific sentence stating exactly what approval is being requested, addressed to
decision_audience — never vague. It should name a specific phase or action ("Approval to begin Phase 0 —
discovery and access only, no build commitment" not "Approval to proceed"). Follow with one line noting
what happens at the end of what's being approved (e.g. what decision point follows).

One closing line: "Full detail in BRD-<doc_id_acronym from the source data, used verbatim>-001."

---
"""
