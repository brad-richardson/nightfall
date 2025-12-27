"use client";

import { useMemo } from "react";

type SparklineProps = {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fillColor?: string;
  showArea?: boolean;
  strokeWidth?: number;
  className?: string;
};

/**
 * Simple sparkline chart component for showing trendlines.
 * Renders an SVG line chart with optional area fill.
 */
export function Sparkline({
  data,
  width = 100,
  height = 32,
  color = "#4ade80",
  fillColor,
  showArea = true,
  strokeWidth = 1.5,
  className = ""
}: SparklineProps) {
  const { path, areaPath } = useMemo(() => {
    if (data.length < 2) {
      return { path: "", areaPath: "" };
    }

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1; // Avoid division by zero

    // Padding from edges
    const padding = 2;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    // Calculate points
    const points = data.map((value, index) => {
      const x = padding + (index / (data.length - 1)) * chartWidth;
      const y = padding + chartHeight - ((value - min) / range) * chartHeight;
      return { x, y };
    });

    // Build SVG path for line
    const linePath = points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(" ");

    // Build area path (closed polygon from line to bottom)
    const areaPathStr =
      linePath +
      ` L ${points[points.length - 1].x.toFixed(1)} ${height - padding}` +
      ` L ${padding} ${height - padding}` +
      " Z";

    return { path: linePath, areaPath: areaPathStr };
  }, [data, width, height]);

  if (data.length < 2) {
    return (
      <svg
        width={width}
        height={height}
        className={className}
        viewBox={`0 0 ${width} ${height}`}
      >
        <text
          x={width / 2}
          y={height / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="currentColor"
          opacity={0.4}
          fontSize={9}
        >
          No data yet
        </text>
      </svg>
    );
  }

  const effectiveFillColor = fillColor || `${color}20`;

  return (
    <svg
      width={width}
      height={height}
      className={className}
      viewBox={`0 0 ${width} ${height}`}
    >
      {showArea && (
        <path d={areaPath} fill={effectiveFillColor} />
      )}
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Dot at the end (current value) */}
      {data.length > 0 && (
        <circle
          cx={width - 2}
          cy={
            2 +
            (height - 4) -
            ((data[data.length - 1] - Math.min(...data)) /
              (Math.max(...data) - Math.min(...data) || 1)) *
              (height - 4)
          }
          r={2.5}
          fill={color}
        />
      )}
    </svg>
  );
}
