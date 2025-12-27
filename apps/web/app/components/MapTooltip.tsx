"use client";

import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { getHealthColor, getRustColor } from "../lib/metricColors";
import { formatLabel } from "../lib/formatters";

export type TooltipData = {
  type: "road" | "building" | "hex";
  position: { x: number; y: number };
  data: RoadData | BuildingData | HexData;
};

export type RoadData = {
  road_class: string;
  health: number;
  status: string;
};

export type BuildingData = {
  category: string;
  generates_food: boolean;
  generates_equipment: boolean;
  generates_energy: boolean;
  generates_materials: boolean;
};

export type HexData = {
  rust_level: number;
};

type MapTooltipProps = {
  tooltip: TooltipData | null;
  containerSize: { width: number; height: number };
};

const DEFAULT_SIZE = { width: 200, height: 120 };
const PADDING = 12;

export function MapTooltip({ tooltip, containerSize }: MapTooltipProps) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipSize, setTooltipSize] = useState(DEFAULT_SIZE);

  useLayoutEffect(() => {
    if (!tooltipRef.current) return;
    const rect = tooltipRef.current.getBoundingClientRect();
    if (rect.width && rect.height) {
      setTooltipSize({ width: rect.width, height: rect.height });
    }
  }, [tooltip]);

  const style = useMemo(() => {
    if (!tooltip) return {};

    const offsetX = 12;
    const offsetY = -8;

    let x = tooltip.position.x + offsetX;
    let y = tooltip.position.y + offsetY;

    if (containerSize.width > 0) {
      x = Math.min(x, containerSize.width - tooltipSize.width - PADDING);
      x = Math.max(PADDING, x);
    }

    if (containerSize.height > 0) {
      y = Math.min(y, containerSize.height - tooltipSize.height - PADDING);
      y = Math.max(PADDING, y);
    }

    return { left: x, top: y };
  }, [tooltip, containerSize.height, containerSize.width, tooltipSize.height, tooltipSize.width]);

  if (!tooltip) return null;

  return (
    <div ref={tooltipRef} className="map-tooltip" style={style}>
      {tooltip.type === "road" && <RoadTooltipContent data={tooltip.data as RoadData} />}
      {tooltip.type === "building" && <BuildingTooltipContent data={tooltip.data as BuildingData} />}
      {tooltip.type === "hex" && <HexTooltipContent data={tooltip.data as HexData} />}
    </div>
  );
}

function RoadTooltipContent({ data }: { data: RoadData }) {
  const healthColor = getHealthColor(data.health);

  return (
    <>
      <div className="tooltip-header">Road Segment</div>
      <div className="tooltip-row">
        <span className="tooltip-label">Class:</span>
        <span className="tooltip-value">{formatLabel(data.road_class)}</span>
      </div>
      <div className="tooltip-row">
        <span className="tooltip-label">Health:</span>
        <span className="tooltip-value" style={{ color: healthColor }}>
          {Math.round(data.health)}%
        </span>
      </div>
      {data.status ? (
        <div className="tooltip-row">
          <span className="tooltip-label">Status:</span>
          <span className="tooltip-value status-badge">{formatLabel(data.status)}</span>
        </div>
      ) : null}
    </>
  );
}

function BuildingTooltipContent({ data }: { data: BuildingData }) {
  const hasResources = data.generates_food || data.generates_equipment || data.generates_energy || data.generates_materials;

  return (
    <>
      <div className="tooltip-header">Building</div>
      <div className="tooltip-row">
        <span className="tooltip-label">Category:</span>
        <span className="tooltip-value">{formatLabel(data.category)}</span>
      </div>
      {hasResources && (
        <div className="tooltip-row">
          <span className="tooltip-label">Generates:</span>
          <div className="tooltip-tags">
            {data.generates_food && <span className="tag food">Food</span>}
            {data.generates_equipment && <span className="tag equipment">Equipment</span>}
            {data.generates_energy && <span className="tag energy">Energy</span>}
            {data.generates_materials && <span className="tag materials">Materials</span>}
          </div>
        </div>
      )}
    </>
  );
}

function HexTooltipContent({ data }: { data: HexData }) {
  const rustColor = getRustColor(data.rust_level);

  return (
    <>
      <div className="tooltip-header">Hex Cell</div>
      <div className="tooltip-row">
        <span className="tooltip-label">Rust Level:</span>
        <span className="tooltip-value" style={{ color: rustColor }}>
          {Math.round(data.rust_level)}%
        </span>
      </div>
    </>
  );
}
