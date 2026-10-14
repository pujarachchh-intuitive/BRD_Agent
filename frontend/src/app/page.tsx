import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Braces,
  Check,
  CircleCheckBig,
  FileCode,
  FileDown,
  FileText,
  Gauge,
  GitCompareArrows,
  ListChecks,
  MessageSquareText,
  Network,
  Presentation,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  Workflow,
} from "lucide-react";
import LandingActions from "@/components/landing/LandingActions";
import "./landing.css";

export const metadata: Metadata = {
  title: "BRD Agent Suite — From project idea to a complete document set",
  description:
    "A multi-agent AI suite that turns a project description into a BRD, TSD, flowchart, architecture diagram, and executive one-pager — cross-checked for consistency.",
};

const STACK = ["Google ADK", "Gemini", "FastAPI", "Next.js", "Databricks Unity Catalog", "Mermaid"];

const DOCUMENTS = [
  {
    icon: FileText,
    tag: "BRD",
    title: "Business Requirements Document",
    audience: "Product & business owners",
    body: "Purpose, objectives, and a scope that separates in-scope, deferred, and permanently excluded work — through to detailed requirements, risks, delivery phases, and sign-off.",
    points: ["Top five features", "Non-functional requirements", "Delivery phases & open questions"],
    featured: true,
  },
  {
    icon: FileCode,
    tag: "TSD",
    title: "Technical Specification Document",
    audience: "Engineering & architecture",
    body: "Requirement traceability back to the BRD, logical architecture, components, data flow, interfaces, security, testing, and deployment — sized to what the project actually needs.",
    points: ["BRD → TSD traceability", "Interfaces & data model", "Security, testing & operations"],
    featured: true,
  },
  {
    icon: Workflow,
    tag: "Flowchart",
    title: "Process Flowchart",
    audience: "Everyone",
    body: "The end-to-end process and data flow as Mermaid source, rendered live in the browser and exportable as PNG.",
  },
  {
    icon: Network,
    tag: "Architecture",
    title: "Architecture Diagram",
    audience: "Engineering",
    body: "System components and how they connect, embedded directly in the BRD and TSD so every document shows the same picture.",
  },
  {
    icon: Presentation,
    tag: "One-Pager",
    title: "Executive One-Pager",
    audience: "Leadership",
    body: "The go/no-go summary: why, what gets delivered, the decisions needed, the risks managed openly, and the ask.",
  },
];

const STEPS = [
  {
    icon: MessageSquareText,
    title: "Describe the project",
    body: "Fill in the structured request form, or describe it in plain English through the chat agent. Leave fields blank or jot a few bullets and tick auto-generate — the AI fleshes them out.",
  },
  {
    icon: Braces,
    title: "Agents draft in parallel",
    body: "Your input becomes one structured requirements model. Five specialist agents then write every document from that single source of truth — at the same time.",
  },
  {
    icon: ListChecks,
    title: "Verify, refine, export",
    body: "A consistency agent cross-checks all five for contradictions. Ask for changes in plain English, then export to Word, PDF, or PNG.",
  },
];

const FEATURES = [
  {
    icon: WandSparkles,
    title: "Auto-generate or enrich any field",
    body: "Know the essentials but not the details? Mark a field and the gap-filler agent completes it, flagging every assumption it made for your review.",
  },
  {
    icon: CircleCheckBig,
    title: "Cross-document consistency check",
    body: "Stack, scope, phasing, traceability, and architecture are compared across all five documents, with a clear pass or a list of contradictions.",
  },
  {
    icon: GitCompareArrows,
    title: "Versioned revisions",
    body: "Request a change in plain English. The suite regenerates it as a new revision linked to the original, so nothing earlier is overwritten.",
  },
  {
    icon: FileDown,
    title: "Export-ready output",
    body: "Download the BRD, TSD, and one-pager as .docx with diagrams embedded as real images, print any document to PDF, or save diagrams as PNG.",
  },
  {
    icon: Gauge,
    title: "Cost & performance visibility",
    body: "Every model call is logged with tokens, latency, and estimated cost, then rolled up per agent and over time on the dashboard.",
  },
  {
    icon: ShieldCheck,
    title: "Secure, role-based access",
    body: "Accounts with role-based permissions, project ownership, and an audit trail, with runs and artifacts stored in Databricks Unity Catalog.",
  },
];

const STATS = [
  { value: "5", label: "documents from every run" },
  { value: "9", label: "specialist AI agents" },
  { value: "1", label: "shared requirements schema" },
  { value: "3", label: "export formats — DOCX, PDF, PNG" },
];

const MOCK_DOCS = [
  { icon: FileText, label: "BRD" },
  { icon: FileCode, label: "TSD" },
  { icon: Workflow, label: "Flowchart" },
  { icon: Network, label: "Architecture" },
  { icon: Presentation, label: "One-Pager" },
];

function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <span className="lp-brand-mark" style={{ width: size, height: size }}>
      <Sparkles size={Math.round(size * 0.5)} strokeWidth={2.25} />
    </span>
  );
}

function ProductPreview() {
  // Purely illustrative — a stylized results page, not live data. Hidden from assistive tech,
  // since the surrounding copy already says everything it shows.
  return (
    <div className="lp-preview" aria-hidden="true">
      <div className="lp-window">
        <div className="lp-window-bar">
          <span className="lp-window-dots">
            <i />
            <i />
            <i />
          </span>
          <span className="lp-window-url">brd-agent-suite / runs / customer-portal-v2</span>
        </div>
        <div className="lp-window-body">
          <div className="lp-window-nav">
            <span className="lp-window-nav-label">Documents</span>
            {MOCK_DOCS.map(({ icon: Icon, label }, i) => (
              <span key={label} className={`lp-window-tab${i === 0 ? " active" : ""}`}>
                <Icon size={13} /> {label}
              </span>
            ))}
          </div>
          <div className="lp-window-doc">
            <div className="lp-doc-kicker">Business Requirements Document</div>
            <div className="lp-doc-title">Customer Portal Modernization</div>
            <div className="lp-doc-meta">
              <span className="lp-pill">Revision 2</span>
              <span className="lp-pill lp-pill-success">
                <Check size={11} strokeWidth={3} /> Consistent
              </span>
            </div>
            <div className="lp-doc-heading">3. Scope</div>
            <div className="lp-line" style={{ width: "92%" }} />
            <div className="lp-line" style={{ width: "78%" }} />
            <div className="lp-doc-heading">4. Detailed Requirements</div>
            <div className="lp-req">
              <span className="lp-req-id">FR-01</span>
              <span className="lp-line" style={{ width: "62%" }} />
              <span className="lp-req-tag">Must</span>
            </div>
            <div className="lp-req">
              <span className="lp-req-id">FR-02</span>
              <span className="lp-line" style={{ width: "54%" }} />
              <span className="lp-req-tag">Must</span>
            </div>
            <div className="lp-req">
              <span className="lp-req-id">FR-03</span>
              <span className="lp-line" style={{ width: "68%" }} />
              <span className="lp-req-tag lp-req-tag-soft">Should</span>
            </div>
            <div className="lp-doc-heading">5.2 Architecture</div>
            <div className="lp-mini-diagram">
              <span className="lp-node">Web app</span>
              <span className="lp-edge" />
              <span className="lp-node lp-node-accent">API</span>
              <span className="lp-edge" />
              <span className="lp-node">Data store</span>
            </div>
          </div>
        </div>
      </div>

      <div className="lp-float lp-float-top">
        <span className="lp-float-icon lp-float-icon-success">
          <CircleCheckBig size={16} />
        </span>
        <div>
          <div className="lp-float-title">Consistency check passed</div>
          <div className="lp-float-sub">All 5 documents aligned</div>
        </div>
      </div>

      <div className="lp-float lp-float-bottom">
        <div className="lp-float-title">Generating in parallel</div>
        {["BRD", "TSD", "Diagrams", "One-Pager"].map((label, i) => (
          <div key={label} className="lp-progress-row">
            <span>{label}</span>
            <span className="lp-progress">
              <span style={{ width: `${[100, 100, 86, 64][i]}%` }} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PipelineDiagram() {
  return (
    <figure className="lp-pipeline">
      <div className="lp-stage">
        <div className="lp-stage-label">1 · Intake</div>
        <div className="lp-stage-card">
          <div className="lp-agent">Extraction agent</div>
          <div className="lp-agent-note">chat → structured requirements</div>
          <div className="lp-agent">Gap-filler agent</div>
          <div className="lp-agent-note">completes &amp; enriches the form</div>
          <div className="lp-agent">Revision agent</div>
          <div className="lp-agent-note">applies a change request</div>
        </div>
      </div>

      <div className="lp-connector" />

      <div className="lp-stage lp-stage-core">
        <div className="lp-stage-label">2 · Source of truth</div>
        <div className="lp-stage-card lp-stage-card-core">
          <Braces size={26} />
          <div className="lp-core-title">Requirements model</div>
          <div className="lp-agent-note">One shared schema every document is generated from</div>
        </div>
      </div>

      <div className="lp-connector" />

      <div className="lp-stage">
        <div className="lp-stage-label">3 · Parallel generation</div>
        <div className="lp-stage-card lp-stage-card-grid">
          {MOCK_DOCS.map(({ icon: Icon, label }) => (
            <span key={label} className="lp-gen-chip">
              <Icon size={14} /> {label}
            </span>
          ))}
        </div>
      </div>

      <div className="lp-connector" />

      <div className="lp-stage">
        <div className="lp-stage-label">4 · Verification</div>
        <div className="lp-stage-card lp-stage-card-verify">
          <CircleCheckBig size={22} />
          <div className="lp-core-title">Consistency check</div>
          <div className="lp-agent-note">Flags contradictions across all five</div>
        </div>
      </div>
      <figcaption className="lp-sr-only">
        Pipeline: an intake agent produces a shared requirements model, five generator agents write the documents in
        parallel, and a consistency agent cross-checks the results.
      </figcaption>
    </figure>
  );
}

export default function LandingPage() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-container lp-nav-inner">
          <Link href="/" className="lp-brand">
            <BrandMark />
            <span className="lp-brand-name">BRD Agent Suite</span>
          </Link>
          <nav className="lp-nav-links" aria-label="Page sections">
            <a href="#documents">Documents</a>
            <a href="#how-it-works">How it works</a>
            <a href="#features">Features</a>
          </nav>
          <LandingActions placement="nav" />
        </div>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-hero-glow" />
          <div className="lp-container lp-hero-inner">
            <div className="lp-hero-copy">
              <span className="lp-eyebrow">
                <Sparkles size={14} /> Multi-agent document generation
              </span>
              <h1 className="lp-hero-title">
                From project idea to a <span className="lp-gradient-text">complete, consistent</span> document set.
              </h1>
              <p className="lp-hero-lede">
                Describe what you&apos;re building. BRD Agent Suite drafts the business requirements, technical
                specification, process flowchart, architecture diagram, and executive one-pager — then checks them
                against each other before you ever hit send.
              </p>
              <LandingActions placement="hero" />
              <ul className="lp-hero-proof">
                <li>
                  <Check size={15} strokeWidth={2.75} /> Five documents from one description
                </li>
                <li>
                  <Check size={15} strokeWidth={2.75} /> Cross-checked for contradictions
                </li>
                <li>
                  <Check size={15} strokeWidth={2.75} /> Word, PDF &amp; PNG export
                </li>
              </ul>
            </div>
            <ProductPreview />
          </div>
        </section>

        <section className="lp-stack" aria-label="Built on">
          <div className="lp-container lp-stack-inner">
            <span className="lp-stack-label">Built on</span>
            <ul className="lp-stack-list">
              {STACK.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
        </section>

        <section id="documents" className="lp-section">
          <div className="lp-container">
            <div className="lp-section-head">
              <span className="lp-kicker">The deliverables</span>
              <h2 className="lp-section-title">Five documents. One source of truth.</h2>
              <p className="lp-section-lede">
                Every document is written from the same structured requirements model, so the numbers, scope, and
                architecture agree from the first draft — for every audience from engineering to the boardroom.
              </p>
            </div>
            <div className="lp-docs-grid">
              {DOCUMENTS.map(({ icon: Icon, tag, title, audience, body, points, featured }) => (
                <article key={tag} className={`lp-doc-card${featured ? " featured" : ""}`}>
                  <div className="lp-doc-card-head">
                    <span className="lp-icon-tile">
                      <Icon size={20} />
                    </span>
                    <span className="lp-doc-tag">{tag}</span>
                  </div>
                  <h3>{title}</h3>
                  <p>{body}</p>
                  {points && (
                    <ul className="lp-doc-points">
                      {points.map((point) => (
                        <li key={point}>
                          <Check size={14} strokeWidth={2.75} /> {point}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="lp-doc-audience">For {audience.toLowerCase()}</div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="lp-section lp-section-alt">
          <div className="lp-container">
            <div className="lp-section-head">
              <span className="lp-kicker">How it works</span>
              <h2 className="lp-section-title">A specialist team of agents, orchestrated for you.</h2>
              <p className="lp-section-lede">
                Instead of one model writing one long document, each deliverable has its own expert agent — all working
                from the same brief, then reviewed by an agent whose only job is to catch disagreements.
              </p>
            </div>
            <ol className="lp-steps">
              {STEPS.map(({ icon: Icon, title, body }, i) => (
                <li key={title} className="lp-step">
                  <div className="lp-step-top">
                    <span className="lp-icon-tile">
                      <Icon size={20} />
                    </span>
                    <span className="lp-step-num">0{i + 1}</span>
                  </div>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </li>
              ))}
            </ol>
            <PipelineDiagram />
          </div>
        </section>

        <section id="features" className="lp-section">
          <div className="lp-container">
            <div className="lp-section-head">
              <span className="lp-kicker">Built for real delivery teams</span>
              <h2 className="lp-section-title">Everything between a blank page and sign-off.</h2>
            </div>
            <div className="lp-features-grid">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <article key={title} className="lp-feature">
                  <span className="lp-icon-tile">
                    <Icon size={20} />
                  </span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-stats" aria-label="At a glance">
          <div className="lp-container lp-stats-grid">
            {STATS.map(({ value, label }) => (
              <div key={label} className="lp-stat">
                <div className="lp-stat-value">{value}</div>
                <div className="lp-stat-label">{label}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="lp-section">
          <div className="lp-container">
            <div className="lp-cta">
              <div className="lp-cta-glow" />
              <div className="lp-cta-copy">
                <h2>Stop starting requirements from a blank page.</h2>
                <p>
                  Go from a rough description to a reviewed, export-ready document set — and spend your time on the
                  decisions, not the formatting.
                </p>
              </div>
              <LandingActions placement="cta" />
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <div className="lp-footer-brand">
            <BrandMark size={28} />
            <div>
              <div className="lp-brand-name">BRD Agent Suite</div>
              <div className="lp-footer-sub">AI document generation, powered by Google ADK &amp; Gemini</div>
            </div>
          </div>
          <nav className="lp-footer-links" aria-label="Footer">
            <a href="#documents">Documents</a>
            <a href="#how-it-works">How it works</a>
            <a href="#features">Features</a>
            <Link href="/login">
              Log in <ArrowRight size={13} />
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
