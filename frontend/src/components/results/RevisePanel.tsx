"use client";

import { useState } from "react";

interface RevisePanelProps {
  disabled: boolean;
  onApply: (changeRequest: string) => Promise<boolean>;
}

export default function RevisePanel({ disabled, onApply }: RevisePanelProps) {
  const [text, setText] = useState("");

  return (
    <div className="panel revise-panel">
      <h2>Request a change</h2>
      <p className="field-helper">Describe what you&apos;d like changed. This creates a new revision run without losing the current one.</p>
      <textarea
        className="field-input"
        rows={3}
        placeholder="e.g. Add a risk about vendor lock-in, or make the timeline 4 phases instead of 3."
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        suppressHydrationWarning
      />
      <div className="mt-3">
        <button
          type="button"
          className="btn btn-primary"
          disabled={disabled}
          onClick={async () => {
            const success = await onApply(text.trim());
            if (success) setText("");
          }}
        >
          Apply Change
        </button>
      </div>
    </div>
  );
}
