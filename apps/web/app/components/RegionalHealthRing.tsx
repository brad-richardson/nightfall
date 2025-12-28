"use client";

import React from "react";
import { getHealthColor, getRustColor } from "../lib/metricColors";

type RegionalHealthRingProps = {
  healthPercent: number;
  rustLevel: number;
  score: number;
  className?: string;
};

const clamp = (value: number) => Math.max(0, Math.min(100, value));

/**
 * Get color for city resilience score.
 * Higher score = healthier city (green), lower = critical (red)
 */
function getScoreColor(score: number): string {
  if (score >= 80) return "#22c55e"; // green-500 - Thriving
  if (score >= 60) return "#84cc16"; // lime-500 - Stable
  if (score >= 40) return "#eab308"; // yellow-500 - Struggling
  if (score >= 20) return "#f97316"; // orange-500 - Critical
  return "#ef4444"; // red-500 - Collapse
}

export default function RegionalHealthRing({ healthPercent, rustLevel, score, className }: RegionalHealthRingProps) {
  const safeHealth = clamp(healthPercent);
  const safeRust = clamp(rustLevel);
  const safeScore = clamp(score);

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
  const scoreColor = getScoreColor(safeScore);

  return (
    <div className={`regional-health-ring${className ? ` ${className}` : ""}`} aria-label="City resilience score">
      <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-hidden="true">
        {/* Background rings */}
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

        {/* Health ring (outer) */}
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

        {/* Rust ring (inner) */}
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

        {/* Score display (center) */}
        <text
          x="70"
          y="66"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="24"
          fontWeight="bold"
          fill={scoreColor}
          style={{ transition: "fill 0.5s ease-out" }}
        >
          {Math.round(safeScore)}
        </text>
        <text
          x="70"
          y="86"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="10"
          fill="rgba(255,255,255,0.6)"
        >
          SCORE
        </text>
      </svg>

      <div className="ring-label">
        <span style={{ color: healthColor }}>
          Health: {Math.round(safeHealth)}%
        </span>
        <span className="rust-label" style={{ color: rustColor, marginLeft: "8px" }}>
          Rust: {Math.round(safeRust)}%
        </span>
      </div>
    </div>
  );
}
