"use client";

import { useRef, useCallback, useState } from "react";
import { formatNumber } from "../../lib/formatters";
import {
  ResourceTrendTooltip,
  useResourceTooltip
} from "../ResourceTrendTooltip";
import type { ResourceType } from "../../lib/resourceHistory";

// Resource colors matching map building styles
const RESOURCE_COLORS = {
  food: "#4ade80", // green-400 - restaurants, cafes
  equipment: "#f97316", // orange-500 - hardware, auto
  energy: "#facc15", // yellow-400 - industrial, power
  materials: "#818cf8" // indigo-400 - construction, lumber
} as const;

type ResourcePoolsPanelProps = {
  poolFood: number;
  poolEquipment: number;
  poolEnergy: number;
  poolMaterials: number;
  foodBuildings: number;
  equipmentBuildings: number;
  energyBuildings: number;
  materialBuildings: number;
  variant?: "light" | "dark";
};

function ResourceBar({
  label,
  value,
  color,
  isLight,
  resourceType,
  onHover,
  onLeave,
  onTap
}: {
  label: string;
  value: number;
  color: string;
  isLight: boolean;
  resourceType: ResourceType;
  onHover: (type: ResourceType, element: HTMLElement) => void;
  onLeave: () => void;
  onTap: (type: ResourceType, element: HTMLElement) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);

  const handleMouseEnter = useCallback(() => {
    if (barRef.current) {
      onHover(resourceType, barRef.current);
    }
  }, [resourceType, onHover]);

  const handleClick = useCallback(() => {
    if (barRef.current) {
      onTap(resourceType, barRef.current);
    }
  }, [resourceType, onTap]);

  return (
    <div
      ref={barRef}
      className="space-y-1 cursor-pointer transition-opacity hover:opacity-80"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={onLeave}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-label={`${label}: ${formatNumber(value)} units. Tap or hover for trend.`}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: color }}
          />
          {label}
        </span>
        <span
          className={`font-semibold ${isLight ? "font-bold" : "text-white"}`}
        >
          {formatNumber(value)}
        </span>
      </div>
      <div
        className={`h-1.5 w-full rounded-full overflow-hidden ${isLight ? "bg-black/10" : "bg-white/10"}`}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.min(100, (value / 2000) * 100)}%`,
            backgroundColor: color,
            boxShadow: `0 0 8px ${color}`
          }}
        />
      </div>
    </div>
  );
}

export function ResourcePoolsPanel({
  poolFood,
  poolEquipment,
  poolEnergy,
  poolMaterials,
  foodBuildings,
  equipmentBuildings,
  energyBuildings,
  materialBuildings,
  variant = "dark"
}: ResourcePoolsPanelProps) {
  const isLight = variant === "light";
  const { activeResource, anchorRect, showTooltip, hideTooltip, hideTooltipImmediate, cancelHideTimeout } =
    useResourceTooltip();
  const [tappedResource, setTappedResource] = useState<ResourceType | null>(null);

  // Handle tap for mobile - toggle tooltip on/off
  const handleTap = useCallback(
    (type: ResourceType, element: HTMLElement) => {
      if (tappedResource === type) {
        // Tapping same resource closes it
        setTappedResource(null);
        hideTooltipImmediate();
      } else {
        // Tapping different resource opens it
        setTappedResource(type);
        showTooltip(type, element);
      }
    },
    [tappedResource, showTooltip, hideTooltipImmediate]
  );

  // On desktop hover, just use the normal hover behavior
  const handleHover = useCallback(
    (type: ResourceType, element: HTMLElement) => {
      setTappedResource(null); // Clear any tap state
      showTooltip(type, element);
    },
    [showTooltip]
  );

  const handleLeave = useCallback(() => {
    if (!tappedResource) {
      hideTooltip();
    }
  }, [tappedResource, hideTooltip]);

  return (
    <div
      className={`space-y-2 text-xs ${isLight ? "text-[color:var(--night-ash)]" : "text-white/70"}`}
    >
      <ResourceBar
        label="Food"
        value={poolFood}
        color={RESOURCE_COLORS.food}
        isLight={isLight}
        resourceType="food"
        onHover={handleHover}
        onLeave={handleLeave}
        onTap={handleTap}
      />
      <ResourceBar
        label="Equipment"
        value={poolEquipment}
        color={RESOURCE_COLORS.equipment}
        isLight={isLight}
        resourceType="equipment"
        onHover={handleHover}
        onLeave={handleLeave}
        onTap={handleTap}
      />
      <ResourceBar
        label="Energy"
        value={poolEnergy}
        color={RESOURCE_COLORS.energy}
        isLight={isLight}
        resourceType="energy"
        onHover={handleHover}
        onLeave={handleLeave}
        onTap={handleTap}
      />
      <ResourceBar
        label="Materials"
        value={poolMaterials}
        color={RESOURCE_COLORS.materials}
        isLight={isLight}
        resourceType="materials"
        onHover={handleHover}
        onLeave={handleLeave}
        onTap={handleTap}
      />
      <div
        className={`mt-2 text-[10px] ${isLight ? "text-[color:var(--night-ash)]" : "text-white/50"}`}
      >
        {isLight ? (
          <>
            <p className="font-semibold text-[color:var(--night-ink)]">
              Contributing buildings
            </p>
            <p>
              {formatNumber(foodBuildings)} Food •{" "}
              {formatNumber(equipmentBuildings)} Equipment •{" "}
              {formatNumber(energyBuildings)} Energy •{" "}
              {formatNumber(materialBuildings)} Materials
            </p>
          </>
        ) : (
          <div className="flex flex-wrap gap-x-2">
            <span>{formatNumber(foodBuildings)} Food</span>
            <span>{formatNumber(equipmentBuildings)} Equip</span>
            <span>{formatNumber(energyBuildings)} Energy</span>
            <span>{formatNumber(materialBuildings)} Mat</span>
          </div>
        )}
      </div>

      {/* Trendline tooltip */}
      {activeResource && (
        <ResourceTrendTooltip
          resourceType={activeResource}
          color={RESOURCE_COLORS[activeResource]}
          isVisible={true}
          isLight={isLight}
          anchorRect={anchorRect}
          onMouseEnter={cancelHideTimeout}
          onMouseLeave={hideTooltip}
        />
      )}
    </div>
  );
}

// Export colors for use in map styles
export { RESOURCE_COLORS };
