"use client";

import { formatPercent } from "../../lib/formatters";

type RegionHealthPanelProps = {
  healthAvg: number;
  rustAvg: number;
  variant?: "light" | "dark";
};

export function RegionHealthPanel({
  healthAvg,
  rustAvg,
  variant = "dark"
}: RegionHealthPanelProps) {
  const isLight = variant === "light";

  return (
    <div className="space-y-3">
      <div className={`flex items-center justify-between text-sm`}>
        <span className={isLight ? "text-[color:var(--night-ash)]" : "text-white/70"}>Avg Health</span>
        <span className={`font-semibold ${isLight ? "text-[color:var(--night-ink)]" : "text-white"}`}>
          {formatPercent(healthAvg / 100)}
        </span>
      </div>
      <div className={`flex items-center justify-between text-sm`}>
        <span className={isLight ? "text-[color:var(--night-ash)]" : "text-white/70"}>Rust Level</span>
        <span className={`font-semibold ${isLight ? "text-[color:var(--night-ink)]" : "text-white"}`}>
          {formatPercent(rustAvg)}
        </span>
      </div>
    </div>
  );
}
