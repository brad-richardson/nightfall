"use client";

import { useEffect, useState } from "react";
import type { RepairMinigameResult } from "../../../store";

type RepairMinigameResultsProps = {
  result: RepairMinigameResult;
  roadClass: string;
  onDismiss: () => void;
};

export default function RepairMinigameResults({
  result,
  roadClass,
  onDismiss,
}: RepairMinigameResultsProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [canDismiss, setCanDismiss] = useState(false);

  const isSuccess = result.success;
  const isPerfect = result.performance >= 90;
  const isGreat = result.performance >= 70;

  // Determine rating
  const getRating = () => {
    if (!isSuccess) {
      return { label: "REPAIR FAILED", icon: "🔧", color: "#ef4444", stars: 0 };
    }
    if (isPerfect) {
      return { label: "PERFECT REPAIR!", icon: "🏆", color: "#fbbf24", stars: 3 };
    }
    if (isGreat) {
      return { label: "GREAT JOB!", icon: "🎯", color: "#4ade80", stars: 2 };
    }
    return { label: "REPAIR COMPLETE", icon: "✓", color: "#60a5fa", stars: 1 };
  };

  const rating = getRating();

  // Format road class nicely
  const formatRoadClass = (cls: string) => {
    return cls.charAt(0).toUpperCase() + cls.slice(1) + " Road";
  };

  // Animate details in after initial reveal
  useEffect(() => {
    const detailsTimer = setTimeout(() => setShowDetails(true), 400);
    // Allow dismiss after 2.5 seconds to give user time to see results
    const dismissTimer = setTimeout(() => setCanDismiss(true), 2500);
    return () => {
      clearTimeout(detailsTimer);
      clearTimeout(dismissTimer);
    };
  }, []);

  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      {/* Success/Fail banner */}
      <div
        className={`mb-4 rounded-2xl border-2 px-8 py-4 text-center transition-all duration-500 ${
          showDetails ? "opacity-100 scale-100" : "opacity-0 scale-90"
        } ${
          isSuccess
            ? "border-green-500/30 bg-green-500/10"
            : "border-red-500/30 bg-red-500/10"
        }`}
      >
        <div className="text-5xl mb-2">{rating.icon}</div>
        <h2
          className="font-display text-2xl font-bold"
          style={{ color: rating.color }}
        >
          {rating.label}
        </h2>
      </div>

      {/* Rating stars */}
      <div className="mb-4 flex gap-1">
        {[1, 2, 3].map((star) => (
          <span
            key={star}
            className={`text-3xl transition-all duration-300 ${
              star <= rating.stars ? "scale-100" : "scale-75 opacity-30"
            }`}
            style={{
              color: star <= rating.stars ? rating.color : undefined,
              transitionDelay: `${star * 100}ms`,
            }}
          >
            ★
          </span>
        ))}
      </div>

      {/* Score display */}
      <p className="mb-6 text-white/60">Score: {result.score} points</p>

      {/* Results card */}
      <div
        className={`w-full max-w-sm transform rounded-2xl border-2 p-6 transition-all duration-500 ${
          showDetails ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
        } ${
          isSuccess
            ? "border-white/20 bg-gradient-to-b from-white/10 to-white/5"
            : "border-red-500/20 bg-red-500/5"
        }`}
      >
        {/* Road info header */}
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/20 text-2xl">
            🛣️
          </span>
          <div>
            <p className="font-medium text-white">{formatRoadClass(roadClass)}</p>
            <p className="text-xs text-white/50">Manual Repair</p>
          </div>
        </div>

        {isSuccess ? (
          <>
            {/* Health restoration display */}
            <div className="mb-4 rounded-xl bg-black/20 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs uppercase tracking-wider text-white/50">
                  Health Restored
                </span>
                <span className="text-lg font-bold text-green-400">
                  +{result.health_restored}%
                </span>
              </div>

              {/* Health bar before/after */}
              <div className="space-y-2">
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs text-white/40">
                    <span>Before</span>
                    <span>{result.new_health - result.health_restored}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full bg-red-400"
                      style={{ width: `${result.new_health - result.health_restored}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs text-white/40">
                    <span>After</span>
                    <span className="text-green-400">{result.new_health}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full bg-green-400 transition-all duration-1000"
                      style={{
                        width: `${result.new_health}%`,
                        transitionDelay: "500ms",
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Success message */}
            <div className="flex items-start gap-2 rounded-xl bg-gradient-to-r from-white/5 to-transparent p-3">
              <span className="text-xl">{isPerfect ? "🔥" : isGreat ? "🚀" : "✨"}</span>
              <p className="text-sm text-white/80">
                {isPerfect && "Exceptional work! Road fully restored!"}
                {isGreat && !isPerfect && "Great repair job! Road significantly improved."}
                {!isGreat && !isPerfect && "Repair complete. Road is more stable now."}
              </p>
            </div>
          </>
        ) : (
          <>
            {/* Failed repair message */}
            <div className="mb-4 rounded-xl bg-red-500/10 p-4 text-center">
              <p className="mb-2 text-white/60">Minimal repair achieved</p>
              <div className="flex items-center justify-center gap-2">
                <span className="text-lg text-white/40">+{result.health_restored}%</span>
              </div>
            </div>

            {/* Encouragement */}
            <div className="flex items-start gap-2 rounded-xl bg-white/5 p-3">
              <span className="text-xl">💡</span>
              <p className="text-sm text-white/60">
                Aim for at least 60% performance to successfully repair! The road still needs work - try again or wait for the crew.
              </p>
            </div>
          </>
        )}

        {/* Performance stat */}
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
          isSuccess
            ? "bg-[color:var(--night-teal)] shadow-[0_4px_16px_rgba(45,212,191,0.3)] focus:ring-[color:var(--night-teal)]"
            : "bg-amber-500 shadow-[0_4px_16px_rgba(245,158,11,0.3)] focus:ring-amber-500"
        }`}
      >
        {canDismiss ? (isSuccess ? "Back to Map" : "Try Again Later") : "..."}
      </button>
    </div>
  );
}
