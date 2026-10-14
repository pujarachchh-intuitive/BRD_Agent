"use client";

import { TEMPLATE_COLORS, TEMPLATE_ICONS, TemplateIcon } from "@/components/templates/TemplateThumb";
import { Domain, TemplateMetaInput } from "@/lib/types";

interface TemplateMetaFieldsProps {
  value: TemplateMetaInput;
  domains: Domain[];
  disabled?: boolean;
  onChange: (value: TemplateMetaInput) => void;
}

/** Name, domain, description, icon and colour — used by "New template" and the Details tab. */
export default function TemplateMetaFields({ value, domains, disabled, onChange }: TemplateMetaFieldsProps) {
  const set = <K extends keyof TemplateMetaInput>(key: K, v: TemplateMetaInput[K]) => onChange({ ...value, [key]: v });

  return (
    <div className="flex flex-col gap-4">
      <div className="studio-field">
        <label htmlFor="tpl-name">Name</label>
        <input
          id="tpl-name"
          className="field-input"
          maxLength={80}
          value={value.name}
          disabled={disabled}
          placeholder="e.g. Healthcare"
          onChange={(e) => set("name", e.target.value)}
        />
      </div>
      <div className="studio-field">
        <label htmlFor="tpl-domain">Domain</label>
        <select
          id="tpl-domain"
          className="field-input cursor-pointer"
          value={value.domain_id}
          disabled={disabled}
          onChange={(e) => set("domain_id", e.target.value)}
        >
          <option value="" disabled>
            Choose a domain…
          </option>
          {domains.map((d) => (
            <option key={d.domain_id} value={d.domain_id}>
              {d.name}
              {d.is_active ? "" : " (hidden)"}
            </option>
          ))}
        </select>
      </div>
      <div className="studio-field">
        <label htmlFor="tpl-description">Description</label>
        <textarea
          id="tpl-description"
          className="field-input"
          rows={2}
          maxLength={300}
          value={value.description}
          disabled={disabled}
          placeholder="Who it's for, and which country's rules it's based on."
          onChange={(e) => set("description", e.target.value)}
        />
      </div>
      <div className="studio-field">
        <span className="studio-label">Icon</span>
        <div className="icon-picker" role="radiogroup" aria-label="Icon">
          {Object.keys(TEMPLATE_ICONS).map((icon) => (
            <button
              key={icon}
              type="button"
              role="radio"
              aria-checked={value.icon === icon}
              aria-label={icon}
              title={icon}
              className={`icon-option${value.icon === icon ? " active" : ""}`}
              style={value.icon === icon ? { color: value.color, borderColor: value.color } : undefined}
              disabled={disabled}
              onClick={() => set("icon", icon)}
            >
              <TemplateIcon icon={icon} size={18} />
            </button>
          ))}
        </div>
      </div>
      <div className="studio-field">
        <span className="studio-label">Colour</span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Colour">
          {TEMPLATE_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={value.color === color}
              aria-label={color}
              className={`color-swatch${value.color === color ? " active" : ""}`}
              style={{ background: color }}
              disabled={disabled}
              onClick={() => set("color", color)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
