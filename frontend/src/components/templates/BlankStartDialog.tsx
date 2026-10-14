"use client";

import { useState } from "react";
import { ArrowRight, Lightbulb } from "lucide-react";
import Modal from "@/components/Modal";
import { DomainSelection } from "@/lib/templateLogic";
import { Domain, PublishedTemplate } from "@/lib/types";
import DomainPicker from "./DomainPicker";

interface BlankStartDialogProps {
  open: boolean;
  domains: Domain[];
  templates: PublishedTemplate[];
  initialDomain: DomainSelection;
  onClose: () => void;
  onStart: (domain: DomainSelection) => void;
  onPreviewTemplate: (template: PublishedTemplate) => void;
}

export default function BlankStartDialog(props: BlankStartDialogProps) {
  // Remounted on every open, so the dialog starts from the form's current domain each time.
  return props.open ? <BlankStartBody {...props} /> : null;
}

function BlankStartBody({ open, domains, templates, initialDomain, onClose, onStart, onPreviewTemplate }: BlankStartDialogProps) {
  const [domain, setDomain] = useState<DomainSelection>(initialDomain);
  const matching = domain && "domain_id" in domain ? templates.find((t) => t.domain_id === domain.domain_id) : undefined;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={<div className="modal-title-text">Start a blank request</div>}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={() => onStart(null)}>
            Skip
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onStart(domain)}>
            Start blank <ArrowRight size={16} />
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label htmlFor="blank-domain" className="field-label font-semibold">
          What domain is this project in? <span className="font-normal" style={{ color: "var(--color-text-muted)" }}>(optional)</span>
        </label>
        <DomainPicker id="blank-domain" domains={domains} value={domain} onChange={setDomain} />
        <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
          Nothing is pre-filled. The domain helps the AI tailor anything you ask it to auto-generate.
        </p>
        {matching && (
          <div className="template-disclaimer">
            <Lightbulb size={15} className="mt-0.5 flex-shrink-0" />
            <span>
              There&apos;s a <strong>{matching.name}</strong> template with common requirements for this domain.{" "}
              <button type="button" className="link-button" onClick={() => onPreviewTemplate(matching)}>
                Preview its suggestions
              </button>
            </span>
          </div>
        )}
      </div>
    </Modal>
  );
}
