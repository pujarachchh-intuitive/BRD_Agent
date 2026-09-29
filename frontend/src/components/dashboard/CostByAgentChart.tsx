"use client";

import { useState } from "react";
import { AgentCost } from "@/lib/dashboardStats";

const ROW_HEIGHT = 30;
const BAR_HEIGHT = 18;
const LABEL_WIDTH = 108;
const CHART_WIDTH = 560;
const TRACK_WIDTH = CHART_WIDTH - LABEL_WIDTH - 60;

export default function CostByAgentChart({ data }: { data: AgentCost[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const maxCost = Math.max(...data.map((d) => d.cost), 0.000001);
  const height = data.length * ROW_HEIGHT;

  return (
    <svg viewBox={`0 0 ${CHART_WIDTH} ${height}`} className="w-full" role="img" aria-label="Estimated generation cost by agent">
      {data.map((d, i) => {
        const y = i * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2;
        const w = Math.max((d.cost / maxCost) * TRACK_WIDTH, 3);
        const isHovered = hovered === i;
        return (
          <g
            key={d.agent}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(i)}
            onBlur={() => setHovered(null)}
            tabIndex={0}
            aria-label={`${d.label}: $${d.cost.toFixed(4)}`}
          >
            <rect x={0} y={i * ROW_HEIGHT} width={CHART_WIDTH} height={ROW_HEIGHT} fill="transparent" />
            <text x={LABEL_WIDTH - 10} y={y + BAR_HEIGHT / 2 + 4} textAnchor="end" fontSize={11} fill="var(--color-text)" fontWeight={500}>
              {d.label}
            </text>
            <rect
              x={LABEL_WIDTH}
              y={y}
              width={w}
              height={BAR_HEIGHT}
              rx={4}
              fill={isHovered ? "var(--color-primary-dark)" : "var(--color-primary)"}
              style={{ transition: "fill 0.1s ease" }}
            />
            <text x={LABEL_WIDTH + w + 8} y={y + BAR_HEIGHT / 2 + 4} fontSize={11} fill="var(--color-text-muted)">
              ${d.cost < 1 ? d.cost.toFixed(4) : d.cost.toFixed(2)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
