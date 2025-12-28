"use client";

import type { MinigameResult, ResourceType } from "../../store";

type MinigameResultsProps = {
  result: MinigameResult;
  buildingName: string;
  resourceType: ResourceType;
  onDismiss: () => void;
};

export default function MinigameResults({
  result,
  buildingName,
  resourceType,
  onDismiss,
}: MinigameResultsProps) {
  const resourceColors: Record<string, string> = {
    food: "#4ade80",
    equipment: "#f97316",
    energy: "#facc15",
    materials: "#818cf8",
  };

  const resourceIcons: Record<string, string> = {
    food: "🍞",
    equipment: "🔧",
    energy: "⚡",
    materials: "📦",
  };

  // Format duration to MM:SS
  const formatDuration = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  // Determine performance rating
  const getRating = (performance: number) => {
    if (performance >= 90) return { label: "PERFECT!", stars: 3, color: "#fbbf24" };
    if (performance >= 70) return { label: "GREAT!", stars: 2, color: "#4ade80" };
    if (performance >= 50) return { label: "GOOD", stars: 1, color: "#60a5fa" };
    return { label: "OKAY", stars: 0, color: "#94a3b8" };
  };

  const rating = getRating(result.performance);

  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      {/* Rating */}
      <div className="mb-4 flex gap-1">
        {[1, 2, 3].map((star) => (
          <span
            key={star}
            className={`text-4xl transition-all ${
              star <= rating.stars ? "scale-100" : "scale-75 opacity-30"
            }`}
            style={{ color: star <= rating.stars ? rating.color : undefined }}
          >
            ★
          </span>
        ))}
      </div>

      <h2
        className="mb-2 font-display text-3xl font-bold"
        style={{ color: rating.color }}
      >
        {rating.label}
      </h2>

      <p className="mb-8 text-white/60">Score: {result.score} points</p>

      {/* Boost info card */}
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="mb-4 flex items-center gap-3">
          <span
            className="flex h-12 w-12 items-center justify-center rounded-xl text-2xl"
            style={{ backgroundColor: `${resourceColors[resourceType]}20` }}
          >
            {resourceIcons[resourceType]}
          </span>
          <div>
            <p className="font-medium text-white">{buildingName}</p>
            <p className="text-xs capitalize text-white/50">{resourceType} production</p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-white/60">Production Boost</span>
            <span
              className="text-xl font-bold"
              style={{ color: resourceColors[resourceType] }}
            >
              {result.multiplier}×
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-white/60">Duration</span>
            <span className="font-medium text-white">
              {formatDuration(result.duration_ms)}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-white/60">Performance</span>
            <span className="font-medium text-white">{result.performance}%</span>
          </div>
        </div>

        {/* Visual boost indicator */}
        <div className="mt-4 rounded-xl bg-gradient-to-r from-white/5 to-white/0 p-4">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🚀</span>
            <p className="text-sm text-white/80">
              This building will produce{" "}
              <span
                className="font-bold"
                style={{ color: resourceColors[resourceType] }}
              >
                {result.multiplier}× {resourceType}
              </span>{" "}
              for the next {formatDuration(result.duration_ms)}
            </p>
          </div>
        </div>
      </div>

      {/* Back button */}
      <button
        onClick={onDismiss}
        className="mt-8 rounded-xl bg-[color:var(--night-teal)] px-8 py-3 text-sm font-semibold uppercase tracking-wider text-white shadow-[0_4px_16px_rgba(45,212,191,0.3)] transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-[color:var(--night-teal)] focus:ring-offset-2 focus:ring-offset-[#0f1216]"
      >
        Back to Map
      </button>
    </div>
  );
}
