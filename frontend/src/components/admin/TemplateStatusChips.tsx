import { AdminTemplate } from "@/lib/types";

export default function TemplateStatusChips({ template }: { template: AdminTemplate }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {template.status === "RETIRED" ? (
        <span className="chip chip-neutral">Retired</span>
      ) : template.published_version ? (
        <span className="chip chip-success">Published v{template.published_version}</span>
      ) : (
        <span className="chip chip-neutral">Not published</span>
      )}
      {template.draft_version && <span className="chip chip-warn">Draft v{template.draft_version}</span>}
    </span>
  );
}
