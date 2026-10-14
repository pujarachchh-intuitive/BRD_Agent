"""Field guide for document extraction: what each requirements-form field means, the different
wordings real project documents use for it, and the question to ask when it's missing.

Kept as data (like rubric.py) so the extraction prompt, the backend's gap detection, and the
review UI's help text all come from one place instead of three hand-maintained copies. Field
names match webapp/service.py's FORM_FIELDS exactly — tests/test_document_ingestion.py checks that.

Nothing in here may contain curly braces: the rendered guide is embedded in an ADK instruction
template, where {name} is read as a session-state placeholder.
"""

from pydantic import BaseModel


class FieldGuideEntry(BaseModel):
    field: str
    label: str
    meaning: str
    synonyms: list[str]
    question: str


FIELD_GUIDE: list[FieldGuideEntry] = [
    FieldGuideEntry(
        field="project_name",
        label="Project Name",
        meaning="The name of the initiative, product, or solution being delivered.",
        synonyms=["project title", "initiative name", "programme/program name", "codename", "solution name", "document title"],
        question="What is the project called?",
    ),
    FieldGuideEntry(
        field="doc_id_acronym",
        label="Doc ID Acronym",
        meaning="A 3-5 letter uppercase short code for the project, only if the documents state one.",
        synonyms=["abbreviation", "short name", "project code", "acronym"],
        question="Is there a short acronym for this project?",
    ),
    FieldGuideEntry(
        field="problem_statement",
        label="Problem Statement",
        meaning="Why this project exists: the problem, pain point, or opportunity it addresses, and for whom.",
        synonyms=["problem", "pain points", "current challenges", "issue", "business need", "opportunity", "rationale", "purpose", "why now"],
        question="What problem does this project solve, and for whom?",
    ),
    FieldGuideEntry(
        field="business_context",
        label="Business Context",
        meaning="Background: the current state, the organisation or market situation, and strategic drivers.",
        synonyms=["background", "current state", "as-is", "context", "strategic alignment", "business drivers", "overview"],
        question="What is the business background or current situation behind this project?",
    ),
    FieldGuideEntry(
        field="decision_audience",
        label="Decision Audience",
        meaning="Who approves or signs off on this project.",
        synonyms=["approvers", "sign-off", "steering committee", "executive sponsor", "governance board", "decision makers"],
        question="Who needs to approve this project?",
    ),
    FieldGuideEntry(
        field="objectives",
        label="Objectives",
        meaning="What the project aims to achieve, each with a measurable success measure where stated.",
        synonyms=["goals", "aims", "outcomes", "expected benefits", "targets", "purpose and objectives"],
        question="What are the main objectives, and how will success be measured for each?",
    ),
    FieldGuideEntry(
        field="stakeholders",
        label="Stakeholders",
        meaning="People, roles, or groups with an interest in or influence over the project (role + their interest).",
        synonyms=["sponsors", "business owners", "approvers", "RACI", "steering committee", "project team", "SMEs", "decision makers", "who is involved", "contacts"],
        question="Who are the key stakeholders (roles) and what is each one's interest in the project?",
    ),
    FieldGuideEntry(
        field="target_users",
        label="Target Users",
        meaning="Who will actually use the solution (persona + what they need from it).",
        synonyms=["end users", "personas", "user groups", "audience", "customers", "operators", "actors", "user roles", "consumers"],
        question="Who are the primary users of the solution, and what does each group need from it?",
    ),
    FieldGuideEntry(
        field="scope_in",
        label="In Scope",
        meaning="What this project explicitly includes or delivers.",
        synonyms=["in scope", "deliverables", "included features", "MVP", "phase 1 scope", "work packages", "scope of work"],
        question="What is explicitly in scope for this project?",
    ),
    FieldGuideEntry(
        field="scope_deferred",
        label="Deferred Scope",
        meaning="Capabilities planned for a later phase, with the reason they are deferred.",
        synonyms=["future phases", "later releases", "phase 2", "backlog", "roadmap items", "post-MVP"],
        question="Is anything planned for a later phase rather than this one?",
    ),
    FieldGuideEntry(
        field="scope_permanently_excluded",
        label="Permanently Excluded",
        meaning="Deliberate boundaries the project will never cross, regardless of phase.",
        synonyms=["out of scope", "exclusions", "not included", "will not", "non-goals"],
        question="What is explicitly out of scope for this project?",
    ),
    FieldGuideEntry(
        field="functional_requirements",
        label="Functional Requirements",
        meaning="What the solution must do: features and capabilities, each with a MoSCoW priority (M/S/C).",
        synonyms=["features", "capabilities", "user stories", "use cases", "the system shall/must", "business requirements", "epics", "functional specification"],
        question="What are the key features or capabilities the solution must provide?",
    ),
    FieldGuideEntry(
        field="non_functional_requirements",
        label="Non-Functional Requirements",
        meaning="Quality attributes the solution must meet (category + requirement).",
        synonyms=["NFRs", "quality attributes", "performance", "availability", "SLA", "security", "compliance", "scalability", "usability", "accessibility", "service levels"],
        question="Are there performance, security, availability, or compliance requirements?",
    ),
    FieldGuideEntry(
        field="constraints",
        label="Constraints",
        meaning="Hard limits the project must work within.",
        synonyms=["limitations", "budget limits", "mandated technology", "regulatory constraints", "fixed deadlines", "resource constraints"],
        question="Are there hard constraints such as budget, mandated platforms, or regulations?",
    ),
    FieldGuideEntry(
        field="success_metrics",
        label="Success Metrics",
        meaning="How the organisation will know the project worked.",
        synonyms=["KPIs", "measures of success", "benefits realisation", "business acceptance criteria", "targets"],
        question="How will you measure whether this project succeeded?",
    ),
    FieldGuideEntry(
        field="dependencies",
        label="Dependencies",
        meaning="What the project depends on to ship.",
        synonyms=["prerequisites", "depends on", "upstream systems", "other teams", "third-party deliverables"],
        question="What does this project depend on (teams, systems, vendors)?",
    ),
    FieldGuideEntry(
        field="tech_stack_preferences",
        label="Tech Stack Preferences",
        meaning="Preferred or mandated technologies, platforms, clouds, languages, and tools.",
        synonyms=["technology", "platform", "cloud provider", "languages", "frameworks", "tools", "existing systems to reuse"],
        question="Are there preferred or mandated technologies or platforms?",
    ),
    FieldGuideEntry(
        field="system_components",
        label="System Components",
        meaning="The building blocks of the solution (name + responsibility + what it interacts with).",
        synonyms=["architecture components", "modules", "services", "layers", "subsystems", "solution architecture"],
        question="What are the main components of the solution?",
    ),
    FieldGuideEntry(
        field="data_flow_steps",
        label="Data Flow Steps",
        meaning="The sequential steps data or requests move through, in order.",
        synonyms=["process flow", "workflow", "data pipeline", "sequence", "end-to-end flow", "how data moves"],
        question="What are the main steps data or requests go through, in order?",
    ),
    FieldGuideEntry(
        field="integrations",
        label="Integrations",
        meaning="External systems the solution connects to.",
        synonyms=["interfaces", "external systems", "APIs", "connectors", "third-party systems", "upstream/downstream systems"],
        question="Which external systems does this need to integrate with?",
    ),
    FieldGuideEntry(
        field="timeline_phases",
        label="Timeline Phases",
        meaning="Delivery phases or milestones (phase + content + exit criteria).",
        synonyms=["milestones", "schedule", "roadmap", "project plan", "go-live", "delivery dates", "releases", "sprints"],
        question="What are the delivery phases or key milestones?",
    ),
    FieldGuideEntry(
        field="open_questions",
        label="Open Questions",
        meaning="Questions the documents themselves mark as unresolved.",
        synonyms=["TBD", "to be confirmed", "unknowns", "parking lot", "items for decision", "pending decisions"],
        question="Are there unresolved questions about this project?",
    ),
    FieldGuideEntry(
        field="risks",
        label="Risks",
        meaning="Things that could go wrong (risk + impact High/Medium/Low + mitigation).",
        synonyms=["risks", "issues", "concerns", "threats", "RAID log", "risk register"],
        question="What are the main risks, and how would you mitigate them?",
    ),
    FieldGuideEntry(
        field="additional_sections",
        label="Additional Sections",
        meaning=(
            "Important project-specific topics that no other field covers (e.g. data migration, training "
            "plan, support model, regulatory filings), each as a titled section."
        ),
        synonyms=["appendix topics", "other considerations", "special requirements"],
        question="Is there anything else important that the sections above don't cover?",
    ),
]

FIELD_GUIDE_BY_NAME: dict[str, FieldGuideEntry] = {entry.field: entry for entry in FIELD_GUIDE}


def render_field_guide() -> str:
    lines = []
    for entry in FIELD_GUIDE:
        lines.append(
            f"- {entry.field} ({entry.label}): {entry.meaning} "
            f"Documents may call this: {', '.join(entry.synonyms)}."
        )
    return "\n".join(lines)
