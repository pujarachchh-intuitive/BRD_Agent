"""DocumentExtraction: what document_extraction_agent produces from uploaded project documents.

Deliberately NOT a RequirementsModel. The extraction step only records what the documents say,
plus the evidence for it; it never fills gaps. Gap-filling happens later, in the existing
gap_filler_agent, after the user has reviewed the extracted form and answered the questions for
anything critical that was missing. So an uncovered field is left empty, and list items carry no
IDs (webapp/service.py's normalize_form assigns those at generation time).

Two things here matter for Gemini's structured output, both found in live testing:
- Every field is required (no defaults), even though "" / [] are valid values. Gemini treats a
  field with a default as optional and tends to skip it: with defaults, it left every list field
  in the form empty while its own field_reports quoted exactly the content that belonged there.
- Fields are generated in declaration order, so field_reports (the evidence) comes before form:
  the model collects the evidence first, then writes the values from it.
"""

from typing import Literal

from pydantic import BaseModel, Field

from .schema import (
    AdditionalSection,
    DeferredScopeItem,
    NonFunctionalRequirement,
    Stakeholder,
    SystemComponent,
    TargetUser,
    TimelinePhase,
)

FieldStatus = Literal["found", "partial", "inferred", "missing"]
Confidence = Literal["high", "medium", "low"]


class ExtractedObjective(BaseModel):
    objective: str
    success_measure: str = Field(description='The measure as stated, or "" if the documents give none.')


class ExtractedRequirement(BaseModel):
    description: str
    priority: Literal["M", "S", "C"] = Field(description="MoSCoW: Must / Should / Could")


class ExtractedRisk(BaseModel):
    risk: str
    impact: Literal["High", "Medium", "Low"]
    mitigation: str = Field(description='The mitigation as stated, or "" if the documents give none.')


class ExtractedForm(BaseModel):
    """Mirrors webapp/service.py's FORM_FIELDS, one attribute per form field. "" or [] means "the
    documents don't cover this"."""

    project_name: str
    doc_id_acronym: str
    problem_statement: str
    business_context: str
    objectives: list[ExtractedObjective]
    stakeholders: list[Stakeholder]
    target_users: list[TargetUser]
    scope_in: list[str]
    scope_deferred: list[DeferredScopeItem]
    scope_permanently_excluded: list[str]
    functional_requirements: list[ExtractedRequirement]
    non_functional_requirements: list[NonFunctionalRequirement]
    constraints: list[str]
    risks: list[ExtractedRisk]
    success_metrics: list[str]
    dependencies: list[str]
    tech_stack_preferences: list[str]
    system_components: list[SystemComponent]
    data_flow_steps: list[str]
    integrations: list[str]
    timeline_phases: list[TimelinePhase]
    open_questions: list[str]
    decision_audience: str
    additional_sections: list[AdditionalSection]


class Evidence(BaseModel):
    file: str = Field(description="The exact file name the quote comes from.")
    location: str = Field(description='Page marker or nearest section heading, e.g. "p.4" or "2.1 Scope"; "" if neither.')
    quote: str = Field(description="A short excerpt copied verbatim from the document, never paraphrased.")


class FieldReport(BaseModel):
    field: str = Field(description="A form field name, exactly as written in the field guide.")
    status: FieldStatus
    confidence: Confidence
    evidence: list[Evidence]
    note: str = Field(description='Why the field is partial/inferred/low-confidence, if it is; otherwise "".')


class ConflictOption(BaseModel):
    value: str
    file: str
    location: str


class Conflict(BaseModel):
    field: str
    description: str
    options: list[ConflictOption]


class GapQuestion(BaseModel):
    field: str
    question: str
    suggested_answers: list[str] = Field(
        description="Candidate answers inferred from the documents, which the user can accept with one click.",
    )


class DocumentExtraction(BaseModel):
    field_reports: list[FieldReport]
    conflicts: list[Conflict]
    form: ExtractedForm
    gap_questions: list[GapQuestion]
    summary: str = Field(description="2-4 sentences: what the documents are and what project they describe.")
    digest: str = Field(description="Project-relevant facts from the documents that no form field holds, as a bullet list.")
