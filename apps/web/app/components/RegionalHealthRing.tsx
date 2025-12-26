"use client";

import React from "react";
import { getHealthColor, getRustColor } from "../lib/metricColors";

type RegionalHealthRingProps = {
  healthPercent: number;
  rustLevel: number;
  className?: string;
};

const clamp = (value: number) => Math.max(0, Math.min(100, value));

export default function RegionalHealthRing({ healthPercent, rustLevel, className }: RegionalHealthRingProps) {
  const safeHealth = clamp(healthPercent);
  const safeRust = clamp(rustLevel);

  const radius = 50;
  const strokeWidth = 8;
  const innerRadius = radius - strokeWidth - 4;
  const innerStrokeWidth = 6;

  const circumference = 2 * Math.PI * radius;
  const healthOffset = circumference - (safeHealth / 100) * circumference;

  const innerCircumference = 2 * Math.PI * innerRadius;
  const rustOffset = innerCircumference - (safeRust / 100) * innerCircumference;

  const healthColor = getHealthColor(safeHealth);
  const rustColor = getRustColor(safeRust);

  return (
    <div className={`regional-health-ring${className ? ` ${className}` : ""}`} aria-label="Regional health">
      <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-hidden="true">
        <circle
          cx="70"
          cy="70"
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx="70"
          cy="70"
          r={innerRadius}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={innerStrokeWidth}
        />

        <circle
          cx="70"
          cy="70"
          r={radius}
          fill="none"
          stroke={healthColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={healthOffset}
          strokeLinecap="round"
          transform="rotate(-90 70 70)"
          style={{ transition: "stroke-dashoffset 1s ease-out, stroke 0.5s ease-out" }}
        />

        <circle
          cx="70"
          cy="70"
          r={innerRadius}
          fill="none"
          stroke={rustColor}
          strokeWidth={innerStrokeWidth}
          strokeDasharray={innerCircumference}
          strokeDashoffset={rustOffset}
          strokeLinecap="round"
          transform="rotate(-90 70 70)"
          style={{ transition: "stroke-dashoffset 1s ease-out" }}
        />

        <text
          x="70"
          y="65"
          textAnchor="middle"
          fontSize="24"
          fontWeight="bold"
          fill={healthColor}
        >
          {Math.round(safeHealth)}%
        </text>
        <text
          x="70"
          y="82"
          textAnchor="middle"
          fontSize="10"
          fill="rgba(255,255,255,0.6)"
        >
          HEALTH
        </text>
      </svg>

      <div className="ring-label">
        <span className="rust-label" style={{ color: rustColor }}>
          Rust: {Math.round(safeRust)}%
        </span>
      </div>
    </div>
  );
}
