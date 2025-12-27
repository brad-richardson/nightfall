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
  const { path, areaPath, endPoint } = useMemo(() => {
    if (data.length < 2) {
      return { path: "", areaPath: "", endPoint: null, isFlat: false };
    }

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min;
    const isFlat = range === 0;

    // Padding from edges
    const padding = 2;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    // Calculate points - for flat data, draw a horizontal line in the middle
    const points = data.map((value, index) => {
      const x = padding + (index / (data.length - 1)) * chartWidth;
      const y = isFlat
        ? padding + chartHeight / 2 // Center line for flat data
        : padding + chartHeight - ((value - min) / range) * chartHeight;
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

    // Store the last point for the endpoint circle
    const lastPoint = points[points.length - 1];

    return {
      path: linePath,
      areaPath: areaPathStr,
      endPoint: lastPoint,
      isFlat
    };
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
      {endPoint && (
        <circle
          cx={endPoint.x}
          cy={endPoint.y}
          r={2.5}
          fill={color}
        />
      )}
    </svg>
  );
}
