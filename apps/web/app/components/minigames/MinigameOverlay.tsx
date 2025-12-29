"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { X } from "lucide-react";
import { useStore } from "../../store";
import { SCORE_ACTIONS } from "@nightfall/config";
import KitchenRush from "./KitchenRush";
import PowerUp from "./PowerUp";
import FreshCheck from "./FreshCheck";
import GearUp from "./GearUp";
import PatchJob from "./PatchJob";
import CraneDrop from "./CraneDrop";
import MinigameResults from "./MinigameResults";

// Minigame types that have been implemented
const IMPLEMENTED_MINIGAMES = ["kitchen_rush", "power_up", "fresh_check", "gear_up", "patch_job", "crane_drop"] as const;

type MinigameOverlayProps = {
  onClose: () => void;
};

export default function MinigameOverlay({ onClose }: MinigameOverlayProps) {
  const activeMinigame = useStore((s) => s.activeMinigame);
  const minigameResult = useStore((s) => s.minigameResult);
  const completeMinigame = useStore((s) => s.completeMinigame);
  const abandonMinigame = useStore((s) => s.abandonMinigame);
  const setMinigameResult = useStore((s) => s.setMinigameResult);
  const addBuildingBoost = useStore((s) => s.addBuildingBoost);
  const addBuildingActivation = useStore((s) => s.addBuildingActivation);
  const addMinigameScore = useStore((s) => s.addMinigameScore);
  const auth = useStore((s) => s.auth);

  const [exiting, setExiting] = useState(false);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const startedAtRef = useRef<number>(Date.now());

  // Set the started time when minigame starts
  useEffect(() => {
    if (activeMinigame) {
      startedAtRef.current = Date.now();
    }
  }, [activeMinigame]);

  const handleExit = useCallback(() => {
    setExiting(true);
    setTimeout(() => {
      onClose();
    }, 300);
  }, [onClose]);

  const handleQuitRequest = useCallback(() => {
    if (activeMinigame && !minigameResult) {
      setShowQuitConfirm(true);
    } else {
      handleExit();
    }
  }, [activeMinigame, minigameResult, handleExit]);

  const handleConfirmQuit = useCallback(async () => {
    if (!activeMinigame) return;

    try {
      await fetch("/api/minigame/abandon", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({
          client_id: auth.clientId,
          session_id: activeMinigame.session_id,
        }),
      });
    } catch (e) {
      console.error("Failed to abandon minigame:", e);
    }

    abandonMinigame();
    handleExit();
  }, [activeMinigame, auth, abandonMinigame, handleExit]);

  const handleGameComplete = useCallback(async (score: number) => {
    if (!activeMinigame) return;

    const durationMs = Date.now() - startedAtRef.current;

    try {
      const res = await fetch("/api/minigame/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({
          client_id: auth.clientId,
          session_id: activeMinigame.session_id,
          score,
          duration_ms: durationMs,
        }),
      });

      const data = await res.json();

      if (data.ok) {
        // Update boost state for UI (only for boost mode)
        if (data.reward) {
          addBuildingBoost({
            building_gers_id: activeMinigame.building_gers_id,
            multiplier: data.reward.multiplier,
            expires_at: data.reward.expires_at,
            minigame_type: activeMinigame.minigame_type,
          });
        }
        // Update building activation state (minigame always activates the building)
        if (data.activation) {
          addBuildingActivation({
            building_gers_id: activeMinigame.building_gers_id,
            activated_at: data.activation.activated_at,
            expires_at: data.activation.expires_at,
          });
        }
        // For quick mode, set minimal result; for boost mode, include full reward info
        completeMinigame({
          score,
          performance: data.performance,
          multiplier: data.reward?.multiplier ?? 1,
          duration_ms: data.reward?.duration_ms ?? 0,
          expires_at: data.reward?.expires_at ?? data.activation?.expires_at ?? "",
        });
        // Award score for minigame completion
        const baseScore = SCORE_ACTIONS.minigameCompleted;
        const perfectBonus = data.performance >= 1.0 ? SCORE_ACTIONS.minigamePerfect : 0;
        addMinigameScore(baseScore + perfectBonus);
      } else {
        console.error("Minigame complete failed:", data.error);
        abandonMinigame();
        handleExit();
      }
    } catch (e) {
      console.error("Failed to complete minigame:", e);
      abandonMinigame();
      handleExit();
    }
  }, [activeMinigame, auth, completeMinigame, abandonMinigame, addBuildingBoost, addBuildingActivation, addMinigameScore, handleExit]);

  const handleResultsDismiss = useCallback(() => {
    setMinigameResult(null);
    handleExit();
  }, [setMinigameResult, handleExit]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleQuitRequest();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleQuitRequest]);

  // Focus the dialog on mount
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  if (!activeMinigame && !minigameResult) return null;

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

  const minigameLabels: Record<string, string> = {
    kitchen_rush: "Kitchen Rush",
    fresh_check: "Fresh Check",
    gear_up: "Gear Up",
    patch_job: "Patch Job",
    power_up: "Power Up",
    crane_drop: "Crane Drop",
  };

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md transition-opacity duration-300 ${
        exiting ? "opacity-0" : "opacity-100"
      }`}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="minigame-title"
        tabIndex={-1}
        className={`relative mx-4 flex h-[80vh] w-full max-w-2xl flex-col rounded-3xl border border-white/10 bg-gradient-to-b from-[#1a1d21] to-[#0f1216] shadow-[0_24px_60px_rgba(0,0,0,0.6)] transition-all duration-300 outline-none ${
          exiting ? "scale-95 opacity-0" : "scale-100 opacity-100"
        }`}
      >
        {/* Close button */}
        <button
          onClick={handleQuitRequest}
          className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-white/40 transition hover:bg-white/10 hover:text-white/80 focus:outline-none focus:ring-2 focus:ring-white/30"
          aria-label="Close minigame"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Show results or active game */}
        {minigameResult ? (
          <MinigameResults
            result={minigameResult}
            buildingName={activeMinigame?.building_name || "Building"}
            resourceType={activeMinigame?.resource_type || "food"}
            mode={activeMinigame?.mode || "boost"}
            onDismiss={handleResultsDismiss}
          />
        ) : activeMinigame ? (
          <div className="flex h-full flex-col">
            {/* Header */}
            <div className="border-b border-white/5 p-6 text-center">
              <p className="text-[10px] uppercase tracking-[0.5em] text-[color:var(--night-teal)]">
                {minigameLabels[activeMinigame.minigame_type]}
              </p>
              <h2 id="minigame-title" className="mt-2 font-display text-xl text-white">
                {activeMinigame.mode === "quick" ? "Quick Activation" : "Boost Production"}
              </h2>
              <div className="mt-2 flex items-center justify-center gap-2">
                <span
                  className="text-lg"
                  style={{ color: resourceColors[activeMinigame.resource_type] }}
                >
                  {resourceIcons[activeMinigame.resource_type]}
                </span>
                <span className="text-sm text-white/60">
                  {activeMinigame.building_name}
                </span>
              </div>
              {activeMinigame.mode === "quick" && (
                <p className="mt-2 text-xs text-white/40">
                  Complete 1 round to activate
                </p>
              )}
            </div>

            {/* Game area */}
            <div className="flex flex-1 items-center justify-center p-6">
              {activeMinigame.minigame_type === "kitchen_rush" && (
                <KitchenRush
                  config={activeMinigame.config}
                  difficulty={activeMinigame.difficulty}
                  onComplete={handleGameComplete}
                />
              )}
              {activeMinigame.minigame_type === "power_up" && (
                <PowerUp
                  config={activeMinigame.config}
                  difficulty={activeMinigame.difficulty}
                  onComplete={handleGameComplete}
                />
              )}
              {activeMinigame.minigame_type === "fresh_check" && (
                <FreshCheck
                  config={activeMinigame.config}
                  difficulty={activeMinigame.difficulty}
                  onComplete={handleGameComplete}
                />
              )}
              {activeMinigame.minigame_type === "gear_up" && (
                <GearUp
                  config={activeMinigame.config}
                  difficulty={activeMinigame.difficulty}
                  onComplete={handleGameComplete}
                />
              )}
              {activeMinigame.minigame_type === "patch_job" && (
                <PatchJob
                  config={activeMinigame.config}
                  difficulty={activeMinigame.difficulty}
                  onComplete={handleGameComplete}
                />
              )}
              {activeMinigame.minigame_type === "crane_drop" && (
                <CraneDrop
                  config={activeMinigame.config}
                  difficulty={activeMinigame.difficulty}
                  onComplete={handleGameComplete}
                />
              )}
              {/* Fallback for unimplemented minigame types */}
              {!IMPLEMENTED_MINIGAMES.includes(activeMinigame.minigame_type as typeof IMPLEMENTED_MINIGAMES[number]) && (
                <div className="text-center text-white/60">
                  <p className="text-lg">Coming Soon</p>
                  <p className="mt-2 text-sm">
                    {minigameLabels[activeMinigame.minigame_type]} is not yet implemented
                  </p>
                  <button
                    onClick={() => handleGameComplete(500)}
                    className="mt-4 rounded-xl bg-[color:var(--night-teal)] px-6 py-3 text-sm font-semibold text-white"
                  >
                    Simulate Completion
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* Quit confirmation modal */}
        {showQuitConfirm && (
          <div className="absolute inset-0 z-20 flex items-center justify-center rounded-3xl bg-black/60 backdrop-blur-sm">
            <div className="mx-4 rounded-2xl border border-white/10 bg-[#1a1d21] p-6 text-center shadow-xl">
              <p className="text-lg font-semibold text-white">Quit Minigame?</p>
              <p className="mt-2 text-sm text-white/60">
                You&apos;ll lose your progress and won&apos;t earn a boost.
              </p>
              <div className="mt-6 flex justify-center gap-3">
                <button
                  onClick={() => setShowQuitConfirm(false)}
                  className="rounded-xl border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-medium text-white/80 transition hover:bg-white/10"
                >
                  Keep Playing
                </button>
                <button
                  onClick={handleConfirmQuit}
                  className="rounded-xl bg-red-500/80 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-red-500"
                >
                  Quit
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
