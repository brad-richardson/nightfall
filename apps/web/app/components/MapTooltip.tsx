"use client";

import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { getHealthColor, getRustColor } from "../lib/metricColors";
import { formatLabel } from "../lib/formatters";
import { RESOURCE_CONFIG } from "../lib/resourceConstants";

export type TooltipData = {
  type: "road" | "building" | "hex" | "crew";
  position: { x: number; y: number };
  data: RoadData | BuildingData | HexData | CrewData;
};

export type RoadData = {
  road_class: string;
  health: number;
  status: string;
  repairCost?: {
    food: number;
    equipment: number;
    energy: number;
    materials: number;
  } | null;
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

export type CrewData = {
  crew_id: string;
  status: string;
  targetRoadName: string | null;
  timeRemaining: number | null; // seconds until busy_until
  destinationCoord: [number, number] | null;
  onFlyToDestination?: () => void;
};

type MapTooltipProps = {
  tooltip: TooltipData | null;
  containerSize: { width: number; height: number };
  onMouseEnter?: () => void;
};

const DEFAULT_SIZE = { width: 200, height: 120 };
const PADDING = 12;

export function MapTooltip({ tooltip, containerSize, onMouseEnter }: MapTooltipProps) {
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
    <div ref={tooltipRef} className="map-tooltip" style={style} onMouseEnter={onMouseEnter}>
      {tooltip.type === "road" && <RoadTooltipContent data={tooltip.data as RoadData} />}
      {tooltip.type === "building" && <BuildingTooltipContent data={tooltip.data as BuildingData} />}
      {tooltip.type === "hex" && <HexTooltipContent data={tooltip.data as HexData} />}
      {tooltip.type === "crew" && <CrewTooltipContent data={tooltip.data as CrewData} />}
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
      {data.repairCost && (
        <div className="tooltip-cost-section">
          <div className="tooltip-cost-label">Repair Cost:</div>
          <div className="tooltip-cost-grid">
            <span className="tag food">
              <span className="tag-emoji">{RESOURCE_CONFIG.food.emoji}</span>
              {data.repairCost.food}
            </span>
            <span className="tag equipment">
              <span className="tag-emoji">{RESOURCE_CONFIG.equipment.emoji}</span>
              {data.repairCost.equipment}
            </span>
            <span className="tag energy">
              <span className="tag-emoji">{RESOURCE_CONFIG.energy.emoji}</span>
              {data.repairCost.energy}
            </span>
            <span className="tag materials">
              <span className="tag-emoji">{RESOURCE_CONFIG.materials.emoji}</span>
              {data.repairCost.materials}
            </span>
          </div>
        </div>
      )}
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

function CrewTooltipContent({ data }: { data: CrewData }) {
  const statusColors: Record<string, string> = {
    idle: "#888888",
    traveling: "#f0ddc2",
    working: "#3eb0c0",
    returning: "#f08a4e"
  };
  const statusColor = statusColors[data.status] || "#888888";

  const formatTimeRemaining = (seconds: number | null) => {
    if (seconds === null || seconds <= 0) return null;
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  };

  const timeStr = formatTimeRemaining(data.timeRemaining);

  return (
    <>
      <div className="tooltip-header">Repair Crew</div>
      <div className="tooltip-row">
        <span className="tooltip-label">Status:</span>
        <span className="tooltip-value" style={{ color: statusColor }}>
          {formatLabel(data.status)}
        </span>
      </div>
      {data.targetRoadName && (
        <div className="tooltip-row">
          <span className="tooltip-label">Target:</span>
          <span className="tooltip-value">{data.targetRoadName}</span>
        </div>
      )}
      {timeStr && (
        <div className="tooltip-row">
          <span className="tooltip-label">ETA:</span>
          <span className="tooltip-value">{timeStr}</span>
        </div>
      )}
      {data.destinationCoord && data.onFlyToDestination && (
        <button
          type="button"
          onClick={data.onFlyToDestination}
          className="tooltip-fly-btn"
        >
          Fly to destination
        </button>
      )}
    </>
  );
}
