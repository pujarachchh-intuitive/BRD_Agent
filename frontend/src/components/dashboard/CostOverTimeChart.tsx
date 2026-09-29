"use client";

import { useId, useState } from "react";
import { DayValue, formatCost } from "@/lib/dashboardStats";

const WIDTH = 700;
const HEIGHT = 180;
const PADDING_BOTTOM = 24;
const PADDING_TOP = 12;

export default function CostOverTimeChart({ data }: { data: DayValue[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const gradientId = useId();
  const maxValue = Math.max(0.001, ...data.map((d) => d.value));
  const plotHeight = HEIGHT - PADDING_BOTTOM - PADDING_TOP;
  const slot = WIDTH / data.length;
  const barWidth = Math.min(22, slot * 0.55);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-label="Estimated generation cost per day, last 14 days">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent-2)" />
            <stop offset="100%" stopColor="var(--color-primary)" />
          </linearGradient>
        </defs>

        <line x1={0} y1={HEIGHT - PADDING_BOTTOM} x2={WIDTH} y2={HEIGHT - PADDING_BOTTOM} stroke="var(--color-border)" strokeWidth={1} />
        <line
          x1={0}
          y1={PADDING_TOP + plotHeight * 0.5}
          x2={WIDTH}
          y2={PADDING_TOP + plotHeight * 0.5}
          stroke="var(--color-border)"
          strokeWidth={1}
          opacity={0.6}
        />

        {data.map((d, i) => {
          const h = (d.value / maxValue) * plotHeight;
          const x = i * slot + (slot - barWidth) / 2;
          const y = HEIGHT - PADDING_BOTTOM - h;
          const isHovered = hovered === i;
          return (
            <g key={d.date}>
              <rect
                x={i * slot}
                y={PADDING_TOP}
                width={slot}
                height={plotHeight}
                fill="transparent"
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(i)}
                onBlur={() => setHovered(null)}
                tabIndex={0}
                aria-label={`${d.label}: ${formatCost(d.value)}`}
              />
              {d.value > 0 && (
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(h, 3)}
                  rx={4}
                  fill={isHovered ? "var(--color-primary-dark)" : `url(#${gradientId})`}
                  style={{ transition: "fill 0.1s ease" }}
                />
              )}
              {(i % 2 === 0 || data.length <= 7) && (
                <text x={i * slot + slot / 2} y={HEIGHT - 6} textAnchor="middle" fontSize={10} fill="var(--color-text-muted)">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hovered !== null && (
        <div
          className="pointer-events-none absolute rounded-md px-2.5 py-1.5 text-xs font-medium shadow-md"
          style={{
            left: `${((hovered + 0.5) / data.length) * 100}%`,
            top: 0,
            transform: "translate(-50%, -100%)",
            background: "var(--color-text)",
            color: "#fff",
            whiteSpace: "nowrap",
          }}
        >
          <span className="font-semibold">{formatCost(data[hovered].value)}</span> · {data[hovered].label}
        </div>
      )}
    </div>
  );
}
