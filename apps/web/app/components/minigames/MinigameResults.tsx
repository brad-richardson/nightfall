"use client";

import { useEffect, useState } from "react";
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
  const [showDetails, setShowDetails] = useState(false);
  const [canDismiss, setCanDismiss] = useState(false);

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

  // Determine if this is a win (got meaningful boost) or loss (minimal/no boost)
  const isWin = result.performance >= 30; // At least 30% performance for a "win"
  const isGreatWin = result.performance >= 70;
  const isPerfect = result.performance >= 90;

  // Determine performance rating
  const getRating = (performance: number) => {
    if (performance >= 90) return { label: "PERFECT!", stars: 3, color: "#fbbf24", icon: "🏆" };
    if (performance >= 70) return { label: "GREAT!", stars: 2, color: "#4ade80", icon: "🎯" };
    if (performance >= 50) return { label: "GOOD", stars: 1, color: "#60a5fa", icon: "👍" };
    if (performance >= 30) return { label: "OKAY", stars: 1, color: "#94a3b8", icon: "✓" };
    return { label: "TRY AGAIN", stars: 0, color: "#ef4444", icon: "💪" };
  };

  const rating = getRating(result.performance);

  // Animate details in after initial reveal
  useEffect(() => {
    const detailsTimer = setTimeout(() => setShowDetails(true), 400);
    // Allow dismiss after 3.5 seconds to give user time to see results
    const dismissTimer = setTimeout(() => setCanDismiss(true), 3500);
    return () => {
      clearTimeout(detailsTimer);
      clearTimeout(dismissTimer);
    };
  }, []);

  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      {/* Win/Loss indicator */}
      <div className={`mb-2 text-6xl transition-transform duration-500 ${showDetails ? "scale-100" : "scale-0"}`}>
        {rating.icon}
      </div>

      {/* Rating stars */}
      <div className="mb-3 flex gap-1">
        {[1, 2, 3].map((star) => (
          <span
            key={star}
            className={`text-3xl transition-all duration-300 ${
              star <= rating.stars ? "scale-100" : "scale-75 opacity-30"
            }`}
            style={{
              color: star <= rating.stars ? rating.color : undefined,
              transitionDelay: `${star * 100}ms`
            }}
          >
            ★
          </span>
        ))}
      </div>

      <h2
        className="mb-1 font-display text-3xl font-bold"
        style={{ color: rating.color }}
      >
        {rating.label}
      </h2>

      <p className="mb-6 text-white/60">Score: {result.score} points</p>

      {/* Boost earned card - the main focus */}
      <div
        className={`w-full max-w-sm transform rounded-2xl border-2 p-6 transition-all duration-500 ${
          showDetails ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
        } ${
          isWin
            ? "border-white/20 bg-gradient-to-b from-white/10 to-white/5"
            : "border-red-500/20 bg-red-500/5"
        }`}
      >
        {/* Header with resource info */}
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

        {isWin ? (
          <>
            {/* Boost earned - prominent display */}
            <div className="mb-4 rounded-xl bg-black/20 p-4 text-center">
              <p className="mb-1 text-xs uppercase tracking-wider text-white/50">Boost Earned</p>
              <div className="flex items-center justify-center gap-3">
                <span
                  className="text-4xl font-bold"
                  style={{ color: resourceColors[resourceType] }}
                >
                  {result.multiplier}×
                </span>
                <span className="text-white/40">for</span>
                <span className="text-2xl font-semibold text-white">
                  {formatDuration(result.duration_ms)}
                </span>
              </div>
            </div>

            {/* Boost effectiveness bar */}
            <div className="mb-4">
              <div className="mb-1 flex justify-between text-xs text-white/50">
                <span>Boost Strength</span>
                <span>{Math.round(Math.max(0, (result.multiplier - 1.5) / 1.5) * 100)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full transition-all duration-1000"
                  style={{
                    width: `${Math.max(0, Math.min(100, (result.multiplier - 1.5) / 1.5 * 100))}%`,
                    backgroundColor: resourceColors[resourceType],
                    transitionDelay: "500ms"
                  }}
                />
              </div>
            </div>

            {/* Summary message */}
            <div className="flex items-start gap-2 rounded-xl bg-gradient-to-r from-white/5 to-transparent p-3">
              <span className="text-xl">{isPerfect ? "🔥" : isGreatWin ? "🚀" : "✨"}</span>
              <p className="text-sm text-white/80">
                {isPerfect && "Maximum boost! Your building is supercharged!"}
                {isGreatWin && !isPerfect && "Great boost! Production significantly increased."}
                {!isGreatWin && "Boost active! Keep playing to earn stronger boosts."}
              </p>
            </div>
          </>
        ) : (
          <>
            {/* Minimal boost message */}
            <div className="mb-4 rounded-xl bg-red-500/10 p-4 text-center">
              <p className="mb-2 text-white/60">Minimal boost earned</p>
              <div className="flex items-center justify-center gap-2">
                <span className="text-2xl font-bold text-white/40">
                  {result.multiplier}×
                </span>
                <span className="text-white/30">for</span>
                <span className="text-lg text-white/40">
                  {formatDuration(result.duration_ms)}
                </span>
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-xl bg-white/5 p-3">
              <span className="text-xl">💡</span>
              <p className="text-sm text-white/60">
                Try again after the cooldown for a better boost! Aim for higher scores to earn stronger production multipliers.
              </p>
            </div>
          </>
        )}

        {/* Performance stat (smaller) */}
        <div className="mt-4 flex justify-center">
          <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-white/40">
            Performance: {result.performance}%
          </span>
        </div>
      </div>

      {/* Back button */}
      <button
        onClick={onDismiss}
        disabled={!canDismiss}
        className={`mt-6 rounded-xl px-8 py-3 text-sm font-semibold uppercase tracking-wider text-white transition-all duration-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#0f1216] ${
          showDetails ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
        } ${
          canDismiss ? "hover:brightness-110" : "cursor-not-allowed opacity-50"
        } ${
          isWin
            ? "bg-[color:var(--night-teal)] shadow-[0_4px_16px_rgba(45,212,191,0.3)] focus:ring-[color:var(--night-teal)]"
            : "bg-white/10 shadow-none focus:ring-white/30"
        }`}
      >
        {canDismiss ? "Back to Map" : "..."}
      </button>
    </div>
  );
}
