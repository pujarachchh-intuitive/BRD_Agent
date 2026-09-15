import { Lightbulb } from "lucide-react";
import { RequirementsJson } from "@/lib/types";

export default function AssumptionsPanel({ reqJson }: { reqJson: RequirementsJson }) {
  const assumptions = reqJson.assumptions ?? [];
  if (!assumptions.length) return null;

  return (
    <div className="panel mb-5" style={{ background: "var(--color-primary-soft)", borderColor: "#cfd8f7" }}>
      <h2 className="flex items-center gap-2">
        <Lightbulb size={16} /> Here&apos;s what I assumed
      </h2>
      <ul className="m-0 pl-5">
        {assumptions.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
