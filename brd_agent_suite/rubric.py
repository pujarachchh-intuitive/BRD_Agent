"""Completeness rubric: what a strong BRD needs as input, encoded as data (not prose),
so the root agent's clarifying-question policy is generated from one source of truth
rather than duplicated by hand inside a prompt string.
"""

from typing import Literal

from pydantic import BaseModel

RequirementLevel = Literal["Critical", "Important", "Nice to have"]


class RubricField(BaseModel):
    field: str
    level: RequirementLevel
    if_missing: str


RUBRIC: list[RubricField] = [
    RubricField(
        field="Problem statement / why this exists",
        level="Critical",
        if_missing="Ask.",
    ),
    RubricField(
        field="Target users / stakeholders",
        level="Critical",
        if_missing="Ask.",
    ),
    RubricField(
        field="Objectives / success measures",
        level="Critical",
        if_missing="Ask if truly absent; otherwise infer from the problem statement and flag as an assumption.",
    ),
    RubricField(
        field="Scope boundaries (what's in/out)",
        level="Important",
        if_missing="Infer conservatively and flag as an assumption.",
    ),
    RubricField(
        field="Functional requirements / key features",
        level="Critical",
        if_missing="Ask.",
    ),
    RubricField(
        field="Non-functional constraints (performance, security, compliance)",
        level="Important",
        if_missing="Infer sensible defaults for this project type and flag as an assumption.",
    ),
    RubricField(
        field="Target platforms / tech constraints",
        level="Important",
        if_missing="Infer and flag as an assumption.",
    ),
    RubricField(
        field="Timeline / phasing expectations",
        level="Nice to have",
        if_missing="Infer a generic phased structure and flag as an assumption.",
    ),
    RubricField(
        field="Known risks / open questions",
        level="Nice to have",
        if_missing="Infer plausible risks for this project type and flag as an assumption.",
    ),
    RubricField(
        field="Audience for the one-pager (who's approving)",
        level="Important",
        if_missing=(
            "Ask if a decision/approval framing is implied by the request; "
            "otherwise default to a general leadership audience."
        ),
    ),
]


def render_rubric_markdown() -> str:
    lines = ["| Field | Level | If missing |", "|---|---|---|"]
    for rf in RUBRIC:
        lines.append(f"| {rf.field} | {rf.level} | {rf.if_missing} |")
    return "\n".join(lines)


CLARIFYING_QUESTION_POLICY = """
Completeness rubric (evaluate every incoming request against this before generating anything):

{rubric_table}

Policy:
- If ANY field marked "Critical" is missing or too vague to write from, ask up to 3 batched
  clarifying questions in a single turn. Never ask one question at a time. Never run more than
  one round of questions unless the user's answers reveal a NEW critical gap.
- If only "Important" or "Nice to have" fields are missing, do NOT ask. Proceed, make the most
  reasonable professional assumption for each gap, and record every assumption you made in a short
  list back to the user (these also get carried into the generated documents' own assumptions list).
- If the user says something like "just make your best guess," "use your judgment," or "skip the
  questions," skip straight to generation and make reasonable assumptions for every gap, including
  Critical ones — flag each one clearly as an assumption rather than presenting it as confirmed fact.
""".format(rubric_table=render_rubric_markdown())
