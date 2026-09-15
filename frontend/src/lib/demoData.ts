// Canned form data for the "Fill Demo Data" button — a fully realistic, complete example (an AI-
// assisted invoice processing system) so a demo can go from blank form to Generate Documents in one
// click, instead of typing out every field live. Every field a real submission would need is
// filled in; nothing is left for auto-generate. Shaped as a DraftFormState (raw editable strings,
// same as what typing into the form produces) so it drops straight into RequestForm's state.

import { DraftFormState } from "./formLogic";

export const DEMO_DRAFT: DraftFormState = {
  project_name: "Automated Invoice Processing & Approval System",
  doc_id_acronym: "AIPA",
  problem_statement:
    "Finance teams manually key in vendor invoices from PDFs and emails, leading to slow approvals, missed early-payment discounts, and duplicate payments caused by human data-entry errors.",
  business_context:
    "The Accounts Payable team processes over 4,000 invoices per month across multiple ERP systems, with an average processing time of 6 days per invoice, causing late-payment penalties and strained vendor relationships. Leadership wants a GenAI-assisted intake and approval workflow to cut cycle time and errors.",
  decision_audience: "VP of Finance Operations",

  scope_in: [
    "Automated ingestion of invoices from email and vendor portal uploads",
    "AI-based extraction of invoice line items, PO numbers, and vendor details",
    "Three-way match against purchase orders and goods receipts",
    "Configurable multi-level approval routing",
    "Exception queue for mismatched or low-confidence extractions",
  ].join("\n"),
  scope_permanently_excluded: ["Replacing the core ERP/general ledger system", "Processing payroll or employee expense reimbursements"].join("\n"),
  constraints: [
    "Must integrate with the existing SAP ERP without modifying core financial modules",
    "Must comply with SOX controls for financial approval workflows",
    "Rollout limited to North America finance operations in Phase 1",
  ].join("\n"),
  success_metrics: [
    "Average invoice cycle time under 24 hours within 6 months of launch",
    "Duplicate payment incidents reduced by 95%",
    "Early-payment discount capture rate increased by at least 15 percentage points",
    "AP team manual data-entry hours reduced by 70%",
  ].join("\n"),
  dependencies: [
    "Access to SAP ERP purchase order and vendor master data via API",
    "Finance team availability to define approval routing rules",
    "IT security review and sign-off before production rollout",
  ].join("\n"),
  tech_stack_preferences: [
    "Python backend services",
    "LLM-based document extraction (e.g., Gemini or GPT-4 class model)",
    "React frontend for the approval dashboard",
    "PostgreSQL for transactional data",
  ].join("\n"),
  data_flow_steps: [
    "Vendor sends invoice via email or uploads to vendor portal",
    "Invoice Ingestion Service normalizes and queues the document",
    "Document Extraction Engine extracts line items, totals, and vendor/PO identifiers",
    "Matching Engine cross-references extracted data against SAP purchase orders and receipts",
    "Approval Workflow Service routes matched invoices to the appropriate approver chain",
    "Approver reviews and approves or rejects via the Approval Dashboard",
    "Approved invoices are posted back to SAP for payment scheduling",
  ].join("\n"),
  integrations: [
    "SAP ERP (purchase orders, vendor master, GL posting)",
    "Corporate email system for invoice intake",
    "Vendor self-service portal",
    "Slack/Teams for approval notifications",
  ].join("\n"),
  open_questions: [
    "Should low-confidence extractions be auto-routed to a human reviewer or block the invoice entirely?",
    "What is the acceptable false-positive rate for duplicate invoice detection?",
  ].join("\n"),

  objectives: [
    {
      objective: "Reduce average invoice processing time from 6 days to under 1 day",
      success_measure: "Median time from invoice receipt to payment approval, measured weekly",
    },
    {
      objective: "Eliminate duplicate and erroneous payments caused by manual entry",
      success_measure: "Duplicate payment rate reduced to near zero, tracked via monthly AP audit",
    },
    {
      objective: "Increase early-payment discount capture",
      success_measure: "Percentage of eligible invoices paid within the discount window, tracked quarterly",
    },
  ],
  stakeholders: [
    { role: "VP of Finance Operations", interest: "Faster close cycles and reduced payment risk" },
    { role: "Accounts Payable Team Lead", interest: "Less manual data entry and fewer exception escalations" },
    { role: "Procurement Manager", interest: "Accurate three-way matching against POs and receipts" },
    { role: "IT Security & Compliance", interest: "Auditable approval trail and data handling compliance" },
  ],
  target_users: [
    { persona: "AP Clerk", needs: "A queue of pre-extracted invoices ready for quick review instead of manual data entry" },
    { persona: "Finance Approver", needs: "Mobile-friendly approval with full invoice context and exception flags" },
    { persona: "Vendor Manager", needs: "Visibility into invoice status to answer vendor inquiries quickly" },
  ],
  scope_deferred: [
    {
      item: "Automated vendor onboarding and KYC verification",
      why_deferred: "Requires a separate compliance workstream not ready for this phase",
    },
    {
      item: "Dynamic discounting marketplace integration",
      why_deferred: "Dependent on a treasury system upgrade planned for next fiscal year",
    },
  ],
  functional_requirements: [
    { description: "Extract invoice header and line-item data from PDF, image, and email attachments using OCR/LLM extraction", priority: "M" },
    { description: "Match extracted invoices against open purchase orders and receiving records automatically", priority: "M" },
    { description: "Route invoices for approval based on configurable amount and department thresholds", priority: "M" },
    { description: "Flag invoices with mismatched totals, missing POs, or duplicate invoice numbers for manual review", priority: "M" },
    { description: "Provide a dashboard showing invoice status, aging, and approval bottlenecks", priority: "S" },
    { description: "Allow approvers to approve, reject, or request clarification from a mobile-friendly interface", priority: "S" },
  ],
  non_functional_requirements: [
    { category: "Performance", requirement: "Invoice extraction and matching must complete within 2 minutes of receipt for 95% of invoices" },
    { category: "Security", requirement: "All financial data must be encrypted in transit and at rest, with role-based access control" },
    { category: "Auditability", requirement: "Every approval action must be logged with timestamp, user, and reason for compliance audits" },
    { category: "Availability", requirement: "System must maintain 99.5% uptime during business hours across all regions" },
  ],
  risks: [
    {
      risk: "Low-confidence extractions on poor-quality scans could stall the approval queue",
      impact: "Medium",
      mitigation: "Route low-confidence documents to a manual review queue instead of blocking the pipeline",
    },
    {
      risk: "SAP integration delays could push back the pilot timeline",
      impact: "Medium",
      mitigation: "Start SAP API access provisioning in Phase 0, in parallel with extraction pipeline development",
    },
  ],
  system_components: [
    {
      name: "Invoice Ingestion Service",
      responsibility: "Receives invoices from email and portal, normalizes formats",
      interacts_with: "Document Extraction Engine, Vendor Portal",
    },
    {
      name: "Document Extraction Engine",
      responsibility: "Uses OCR and LLM parsing to extract structured invoice data",
      interacts_with: "Invoice Ingestion Service, Matching Engine",
    },
    {
      name: "Matching Engine",
      responsibility: "Performs three-way match against PO and receipt records",
      interacts_with: "SAP ERP, Approval Workflow Service",
    },
    {
      name: "Approval Workflow Service",
      responsibility: "Routes invoices through configurable approval chains",
      interacts_with: "Matching Engine, Notification Service, Approval Dashboard",
    },
    {
      name: "Approval Dashboard",
      responsibility: "Web/mobile UI for approvers and AP staff",
      interacts_with: "Approval Workflow Service",
    },
  ],
  timeline_phases: [
    {
      phase: "Phase 0",
      content: "Discovery, SAP integration design, and approval workflow mapping",
      exit_criteria: "Signed-off integration design and approval matrix",
    },
    {
      phase: "Phase 1",
      content: "Build ingestion, extraction, and matching pipeline; pilot with one vendor category",
      exit_criteria: "Pilot invoices processed end-to-end with 90% match accuracy",
    },
    {
      phase: "Phase 2",
      content: "Full rollout to North America AP team with dashboard and mobile approvals",
      exit_criteria: "All North America invoices processed through the new system for one full month",
    },
  ],
  additional_sections: [
    {
      title: "Change Management & Training Plan",
      content:
        "AP staff will receive hands-on training during the Phase 1 pilot, with updated SOPs published before Phase 2 rollout. A dedicated support channel will be staffed for the first 30 days post-launch to handle questions and edge cases.",
    },
  ],
};
