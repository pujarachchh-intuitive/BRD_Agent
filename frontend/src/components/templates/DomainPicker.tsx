"use client";

import { useState } from "react";
import { DomainSelection } from "@/lib/templateLogic";
import { Domain } from "@/lib/types";

const OTHER = "__other__";
export const MAX_OTHER_DOMAIN_LENGTH = 60;

interface DomainPickerProps {
  id: string;
  domains: Domain[];
  value: DomainSelection;
  onChange: (value: DomainSelection) => void;
  disabled?: boolean;
}

/** Optional domain: pick one from the admin-managed list, or choose Other and type it. */
export default function DomainPicker({ id, domains, value, onChange, disabled }: DomainPickerProps) {
  // "Other" stays selected while its text box is still empty, which `value` alone can't express.
  const [otherChosen, setOtherChosen] = useState(value !== null && "other" in value);
  const selectValue = value && "domain_id" in value ? value.domain_id : otherChosen ? OTHER : "";
  const otherText = value && "other" in value ? value.other : "";

  function handleSelect(next: string) {
    if (next === OTHER) {
      setOtherChosen(true);
      onChange(otherText ? { other: otherText } : null);
      return;
    }
    setOtherChosen(false);
    const domain = domains.find((d) => d.domain_id === next);
    onChange(domain ? { domain_id: domain.domain_id, name: domain.name } : null);
  }

  return (
    <div className="flex flex-col gap-2">
      <select
        id={id}
        className="field-input cursor-pointer"
        value={selectValue}
        disabled={disabled}
        onChange={(e) => handleSelect(e.target.value)}
      >
        <option value="">No specific domain</option>
        {domains.map((d) => (
          <option key={d.domain_id} value={d.domain_id}>
            {d.name}
          </option>
        ))}
        <option value={OTHER}>Other…</option>
      </select>
      {otherChosen && (
        <input
          type="text"
          className="field-input"
          placeholder="Type the domain, e.g. Agritech"
          maxLength={MAX_OTHER_DOMAIN_LENGTH}
          value={otherText}
          disabled={disabled}
          autoFocus
          aria-label="Other domain"
          onChange={(e) => onChange(e.target.value.trim() ? { other: e.target.value } : null)}
          suppressHydrationWarning
        />
      )}
    </div>
  );
}
