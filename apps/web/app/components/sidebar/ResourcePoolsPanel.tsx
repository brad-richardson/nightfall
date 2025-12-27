"use client";

import { formatNumber } from "../../lib/formatters";

type ResourcePoolsPanelProps = {
  poolLabor: number;
  poolMaterials: number;
  laborBuildings: number;
  materialBuildings: number;
  variant?: "light" | "dark";
};

export function ResourcePoolsPanel({
  poolLabor,
  poolMaterials,
  laborBuildings,
  materialBuildings,
  variant = "dark"
}: ResourcePoolsPanelProps) {
  const isLight = variant === "light";

  return (
    <div className={`space-y-3 text-xs ${isLight ? "text-[color:var(--night-ash)]" : "text-white/70"}`}>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span>Labor</span>
          <span className={`font-semibold ${isLight ? "font-bold" : "text-white"}`}>
            {formatNumber(poolLabor)}
          </span>
        </div>
        <div className={`h-1.5 w-full rounded-full overflow-hidden ${isLight ? "bg-black/10" : "bg-white/10"}`}>
          <div
            className="h-full rounded-full bg-[color:var(--night-teal)] shadow-[0_0_8px_var(--night-teal)] transition-all duration-500"
            style={{ width: `${Math.min(100, (poolLabor / 1000) * 100)}%` }}
          />
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span>Materials</span>
          <span className={`font-semibold ${isLight ? "font-bold" : "text-white"}`}>
            {formatNumber(poolMaterials)}
          </span>
        </div>
        <div className={`h-1.5 w-full rounded-full overflow-hidden ${isLight ? "bg-black/10" : "bg-white/10"}`}>
          <div
            className="h-full rounded-full bg-[color:var(--night-glow)] shadow-[0_0_8px_var(--night-glow)] transition-all duration-500"
            style={{ width: `${Math.min(100, (poolMaterials / 1000) * 100)}%` }}
          />
        </div>
      </div>
      <div className={`mt-3 text-[10px] ${isLight ? "text-[color:var(--night-ash)]" : "text-white/50"}`}>
        {isLight ? (
          <>
            <p className="font-semibold text-[color:var(--night-ink)]">Contributing buildings</p>
            <p>Labor: {formatNumber(laborBuildings)} • Materials: {formatNumber(materialBuildings)}</p>
          </>
        ) : (
          <>Buildings: {formatNumber(laborBuildings)} Labor • {formatNumber(materialBuildings)} Materials</>
        )}
      </div>
    </div>
  );
}
