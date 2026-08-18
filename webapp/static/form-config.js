/* form-config.js
 * Declarative description of the request form. Mirrors service.FORM_FIELDS in webapp/service.py
 * exactly (field name -> kind), plus the display metadata (labels, helper text, sub-fields) needed
 * to render it. This is the single source of truth app.js builds the form from.
 *
 * kind: "scalar" | "list_str" | "list_obj"
 */

const FORM_SECTIONS = [
  {
    title: "Problem & Context",
    fields: ["problem_statement", "project_name", "doc_id_acronym", "business_context", "decision_audience"],
  },
  { title: "Objectives", fields: ["objectives"] },
  { title: "Stakeholders & Users", fields: ["stakeholders", "target_users"] },
  { title: "Scope", fields: ["scope_in", "scope_deferred", "scope_permanently_excluded"] },
  { title: "Requirements", fields: ["functional_requirements", "constraints", "success_metrics", "dependencies"] },
  { title: "Non-Functional Requirements", fields: ["non_functional_requirements"] },
  { title: "Risks", fields: ["risks"] },
  { title: "Architecture & Tech", fields: ["tech_stack_preferences", "system_components", "data_flow_steps", "integrations"] },
  { title: "Timeline", fields: ["timeline_phases"] },
  { title: "Open Questions", fields: ["open_questions"] },
  { title: "Additional Sections", fields: ["additional_sections"] },
];

const FIELD_DEFS = {
  project_name: {
    kind: "scalar",
    label: "Project Name",
    input: "text",
    placeholder: "e.g. TeamPulse",
    critical: true,
  },
  doc_id_acronym: {
    kind: "scalar",
    label: "Doc ID Acronym",
    input: "text",
    placeholder: "e.g. FBH",
    helper: "3-5 letter acronym. Leave blank to auto-generate from the project name.",
  },
  problem_statement: {
    kind: "scalar",
    label: "Problem Statement",
    input: "textarea",
    placeholder: "What problem are we solving, and for whom?",
    prominent: true,
    critical: true,
  },
  business_context: {
    kind: "scalar",
    label: "Business Context",
    input: "textarea",
  },
  decision_audience: {
    kind: "scalar",
    label: "Decision Audience",
    input: "text",
    helper: "Who is approving this? e.g. 'VP of Engineering' — drives the one-pager's tone.",
  },

  scope_in: {
    kind: "list_str",
    label: "In Scope",
    helper: "What's explicitly in scope",
  },
  scope_permanently_excluded: {
    kind: "list_str",
    label: "Permanently Excluded",
    helper: "What this will never do, regardless of phase (not the same as deferred)",
  },
  constraints: {
    kind: "list_str",
    label: "Constraints",
    helper: "Hard constraints (compliance, platform, budget, etc.)",
  },
  success_metrics: {
    kind: "list_str",
    label: "Success Metrics",
    helper: "How you'll know this worked",
  },
  dependencies: {
    kind: "list_str",
    label: "Dependencies",
    helper: "What this depends on to ship",
  },
  tech_stack_preferences: {
    kind: "list_str",
    label: "Tech Stack Preferences",
    helper: "Preferred languages/frameworks/services, if any",
  },
  data_flow_steps: {
    kind: "list_str",
    label: "Data Flow Steps",
    helper: "The sequential steps data/requests move through (order matters)",
  },
  integrations: {
    kind: "list_str",
    label: "Integrations",
    helper: "External systems this connects to",
  },
  open_questions: {
    kind: "list_str",
    label: "Open Questions",
    helper: "Genuinely unresolved questions",
  },

  objectives: {
    kind: "list_obj",
    label: "Objectives",
    helper: "What you're trying to achieve and how you'll measure it",
    subfields: [
      { name: "objective", label: "Objective", type: "text" },
      { name: "success_measure", label: "Success Measure", type: "text" },
    ],
  },
  stakeholders: {
    kind: "list_obj",
    label: "Stakeholders",
    subfields: [
      { name: "role", label: "Role", type: "text" },
      { name: "interest", label: "Interest", type: "text" },
    ],
    critical: true,
  },
  target_users: {
    kind: "list_obj",
    label: "Target Users",
    subfields: [
      { name: "persona", label: "Persona", type: "text" },
      { name: "needs", label: "Needs", type: "text" },
    ],
    critical: true,
  },
  scope_deferred: {
    kind: "list_obj",
    label: "Deferred Scope",
    helper: "Candidates for a later phase, and why they're not in this one",
    subfields: [
      { name: "item", label: "Item", type: "text" },
      { name: "why_deferred", label: "Why Deferred", type: "text" },
    ],
  },
  functional_requirements: {
    kind: "list_obj",
    label: "Functional Requirements",
    helper: "M = Must have, S = Should have, C = Could have. Auto-generate/enrich will keep every requirement you list and add any more it thinks the solution needs.",
    subfields: [
      { name: "description", label: "Description", type: "text" },
      { name: "priority", label: "Priority", type: "select", options: ["M", "S", "C"], default: "M" },
    ],
  },
  non_functional_requirements: {
    kind: "list_obj",
    label: "Non-Functional Requirements",
    subfields: [
      { name: "category", label: "Category", type: "text", placeholder: "e.g. Performance" },
      { name: "requirement", label: "Requirement", type: "text" },
    ],
  },
  risks: {
    kind: "list_obj",
    label: "Risks",
    subfields: [
      { name: "risk", label: "Risk", type: "text" },
      { name: "impact", label: "Impact", type: "select", options: ["High", "Medium", "Low"], default: "Medium" },
      { name: "mitigation", label: "Mitigation", type: "text" },
    ],
  },
  system_components: {
    kind: "list_obj",
    label: "System Components",
    subfields: [
      { name: "name", label: "Name", type: "text" },
      { name: "responsibility", label: "Responsibility", type: "text" },
      { name: "interacts_with", label: "Interacts With", type: "text", placeholder: "comma-separated, e.g. API, Database", isList: true },
    ],
  },
  timeline_phases: {
    kind: "list_obj",
    label: "Timeline Phases",
    subfields: [
      { name: "phase", label: "Phase", type: "text", placeholder: "e.g. Phase 0" },
      { name: "content", label: "Content", type: "text" },
      { name: "exit_criteria", label: "Exit Criteria", type: "text" },
    ],
  },
  additional_sections: {
    kind: "list_obj",
    label: "Additional Sections",
    helper:
      "Something your project needs that none of the sections above cover? Add it here as its own " +
      "section, title and all — it's appended to the BRD and TSD as-is (lightly polished, not " +
      "auto-generated, since only you know what belongs here).",
    subfields: [
      { name: "title", label: "Section Title", type: "text", placeholder: "e.g. Regulatory Filing Requirements" },
      { name: "content", label: "Content", type: "textarea", placeholder: "Write as much or as little as you'd like." },
    ],
    skipToggles: true,
  },
};
