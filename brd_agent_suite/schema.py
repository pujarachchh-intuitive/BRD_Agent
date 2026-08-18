"""RequirementsModel: the shared, schema-valid source of truth every generator agent reads.

Produced once by extraction_agent (Gemini structured output), then templated as
{requirements_json} into every downstream generator's instruction string.
"""

from typing import Literal

from pydantic import BaseModel, Field


class Objective(BaseModel):
    id: str = Field(description='e.g. "OBJ-01"')
    objective: str
    success_measure: str = Field(description="Measurable criterion — never just a restated goal.")


class Stakeholder(BaseModel):
    role: str
    interest: str


class TargetUser(BaseModel):
    persona: str
    needs: str


class DeferredScopeItem(BaseModel):
    item: str
    why_deferred: str


class FunctionalRequirement(BaseModel):
    id: str = Field(description='e.g. "BR-01". Stable — carried unchanged into the TSD traceability table.')
    description: str
    priority: Literal["M", "S", "C"] = Field(description="MoSCoW: Must / Should / Could")


class NonFunctionalRequirement(BaseModel):
    category: str = Field(description="e.g. Performance, Scalability, Reliability, Security, Auditability, Extensibility")
    requirement: str


class Risk(BaseModel):
    id: str = Field(description='e.g. "R-01"')
    risk: str
    impact: Literal["High", "Medium", "Low"]
    mitigation: str


class SystemComponent(BaseModel):
    name: str
    responsibility: str
    interacts_with: list[str] = Field(default_factory=list)


class TimelinePhase(BaseModel):
    phase: str
    content: str
    exit_criteria: str


class AdditionalSection(BaseModel):
    title: str
    content: str


class RequirementsModel(BaseModel):
    project_name: str
    doc_id_acronym: str = Field(
        description=(
            "A 3-5 letter uppercase acronym derived from project_name, decided once here so every "
            "generated document (BRD-<acronym>-001, etc.) references the identical value instead of "
            "each generator inventing its own."
        )
    )
    problem_statement: str
    business_context: str

    objectives: list[Objective]
    stakeholders: list[Stakeholder]
    target_users: list[TargetUser]

    scope_in: list[str]
    scope_deferred: list[DeferredScopeItem]
    scope_permanently_excluded: list[str]

    functional_requirements: list[FunctionalRequirement]
    non_functional_requirements: list[NonFunctionalRequirement]

    assumptions: list[str] = Field(
        description="Every inferred field (per the completeness rubric) must produce one entry here."
    )
    constraints: list[str]
    risks: list[Risk]
    success_metrics: list[str]
    dependencies: list[str]
    tech_stack_preferences: list[str]

    system_components: list[SystemComponent]
    data_flow_steps: list[str] = Field(description="Sequential, narrative steps.")
    integrations: list[str]

    timeline_phases: list[TimelinePhase]
    open_questions: list[str]

    decision_audience: str = Field(
        description="Who this is being pitched to — drives the one-pager's tone and THE ASK framing."
    )

    excluded_sections: list[str] = Field(
        default_factory=list,
        description=(
            "Field names the user explicitly marked as not applicable to this project (e.g. "
            "'risks', 'non_functional_requirements'). The BRD/TSD generators omit the corresponding "
            "section entirely rather than rendering it empty. Never includes a critical field "
            "(project_name, problem_statement, stakeholders, target_users, functional_requirements)."
        ),
    )
    additional_sections: list[AdditionalSection] = Field(
        default_factory=list,
        description=(
            "User-authored custom sections not covered by any other field, appended to the BRD and "
            "TSD as extra numbered sections. Not used in the one-pager, which keeps its fixed template."
        ),
    )
