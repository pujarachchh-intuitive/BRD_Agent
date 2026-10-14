import {
  Building,
  Clapperboard,
  BedDouble,
  Cpu,
  Factory,
  FileText,
  FlaskConical,
  GraduationCap,
  HeartPulse,
  Landmark,
  LucideIcon,
  RadioTower,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Zap,
} from "lucide-react";

/** Template icon names (webapp/doc_templates/schemas.py ICONS) -> their glyph. */
export const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  health: HeartPulse,
  finance: Landmark,
  insurance: ShieldCheck,
  pharma: FlaskConical,
  government: Building,
  retail: ShoppingCart,
  education: GraduationCap,
  factory: Factory,
  telecom: RadioTower,
  energy: Zap,
  logistics: Truck,
  media: Clapperboard,
  hospitality: BedDouble,
  realestate: Building,
  technology: Cpu,
  generic: FileText,
};

export const TEMPLATE_COLORS = [
  "#0f9d8a", "#2563eb", "#7c3aed", "#db2777", "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#4f46e5", "#475569",
];

export function TemplateIcon({ icon, size = 18 }: { icon: string; size?: number }) {
  const Icon = TEMPLATE_ICONS[icon] ?? FileText;
  return <Icon size={size} strokeWidth={2} aria-hidden />;
}

/** A miniature document page — the gallery's Word-style template preview. */
export default function TemplateThumb({ icon, color, size = "md" }: { icon: string; color: string; size?: "sm" | "md" }) {
  return (
    <div className={`template-thumb template-thumb-${size}`} style={{ ["--thumb-color" as string]: color }} aria-hidden>
      <div className="template-thumb-band">
        <TemplateIcon icon={icon} size={size === "sm" ? 14 : 20} />
      </div>
      <div className="template-thumb-lines">
        <span style={{ width: "72%" }} />
        <span style={{ width: "90%" }} />
        <span style={{ width: "58%" }} />
        <span className="template-thumb-gap" />
        <span style={{ width: "84%" }} />
        <span style={{ width: "66%" }} />
      </div>
    </div>
  );
}
