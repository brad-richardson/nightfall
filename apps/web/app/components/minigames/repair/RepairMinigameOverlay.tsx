"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { X } from "lucide-react";
import { useStore } from "../../../store";
import PotholePatrol from "./PotholePatrol";
import RoadRoller from "./RoadRoller";
import TrafficDirector from "./TrafficDirector";
import RepairMinigameResults from "./RepairMinigameResults";

type RepairMinigameOverlayProps = {
  onClose: () => void;
};

const MINIGAME_LABELS: Record<string, string> = {
  pothole_patrol: "Pothole Patrol",
  road_roller: "Road Roller",
  traffic_director: "Traffic Director",
};

export default function RepairMinigameOverlay({ onClose }: RepairMinigameOverlayProps) {
  const activeRepairMinigame = useStore((s) => s.activeRepairMinigame);
  const repairMinigameResult = useStore((s) => s.repairMinigameResult);
  const completeRepairMinigame = useStore((s) => s.completeRepairMinigame);
  const abandonRepairMinigame = useStore((s) => s.abandonRepairMinigame);
  const setRepairMinigameResult = useStore((s) => s.setRepairMinigameResult);
  const setFeatures = useStore((s) => s.setFeatures);
  const addMinigameScore = useStore((s) => s.addMinigameScore);
  const auth = useStore((s) => s.auth);

  const [exiting, setExiting] = useState(false);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const startedAtRef = useRef<number>(Date.now());

  // Set the started time when minigame starts
  useEffect(() => {
    if (activeRepairMinigame) {
      startedAtRef.current = Date.now();
    }
  }, [activeRepairMinigame]);

  const handleExit = useCallback(() => {
    setExiting(true);
    setTimeout(() => {
      onClose();
    }, 300);
  }, [onClose]);

  const handleQuitRequest = useCallback(() => {
    if (activeRepairMinigame && !repairMinigameResult) {
      setShowQuitConfirm(true);
    } else {
      handleExit();
    }
  }, [activeRepairMinigame, repairMinigameResult, handleExit]);

  const handleConfirmQuit = useCallback(async () => {
    if (!activeRepairMinigame) return;

    try {
      await fetch("/api/repair-minigame/abandon", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({
          client_id: auth.clientId,
          session_id: activeRepairMinigame.session_id,
        }),
      });
    } catch (e) {
      console.error("Failed to abandon repair minigame:", e);
    }

    abandonRepairMinigame();
    handleExit();
  }, [activeRepairMinigame, auth, abandonRepairMinigame, handleExit]);

  const handleGameComplete = useCallback(
    async (score: number) => {
      if (!activeRepairMinigame) return;

      const durationMs = Date.now() - startedAtRef.current;

      try {
        const res = await fetch("/api/repair-minigame/complete", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify({
            client_id: auth.clientId,
            session_id: activeRepairMinigame.session_id,
            score,
            duration_ms: durationMs,
          }),
        });

        const data = await res.json();

        if (data.ok) {
          // Update feature health in store
          setFeatures((prev) =>
            prev.map((f) =>
              f.gers_id === activeRepairMinigame.road_gers_id
                ? { ...f, health: data.new_health, status: data.new_health >= 70 ? "normal" : "degraded" }
                : f
            )
          );

          // Set result for display
          completeRepairMinigame({
            score,
            performance: data.performance,
            success: data.success,
            new_health: data.new_health,
            health_restored: data.health_restored,
          });

          // Award score for repair minigame
          if (data.score_awarded) {
            addMinigameScore(data.score_awarded);
          }
        } else {
          console.error("Repair minigame complete failed:", data.error);
          abandonRepairMinigame();
          handleExit();
        }
      } catch (e) {
        console.error("Failed to complete repair minigame:", e);
        abandonRepairMinigame();
        handleExit();
      }
    },
    [activeRepairMinigame, auth, completeRepairMinigame, abandonRepairMinigame, setFeatures, addMinigameScore, handleExit]
  );

  const handleResultsDismiss = useCallback(() => {
    setRepairMinigameResult(null);
    handleExit();
  }, [setRepairMinigameResult, handleExit]);

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

  if (!activeRepairMinigame && !repairMinigameResult) return null;

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
        aria-labelledby="repair-minigame-title"
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
        {repairMinigameResult ? (
          <RepairMinigameResults
            result={repairMinigameResult}
            roadClass={activeRepairMinigame?.road_class || "road"}
            onDismiss={handleResultsDismiss}
          />
        ) : activeRepairMinigame ? (
          <div className="flex h-full flex-col">
            {/* Header */}
            <div className="border-b border-white/5 p-6 text-center">
              <p className="text-[10px] uppercase tracking-[0.5em] text-amber-400">
                {MINIGAME_LABELS[activeRepairMinigame.minigame_type]}
              </p>
              <h2 id="repair-minigame-title" className="mt-2 font-display text-xl text-white">
                Manual Repair
              </h2>
              <div className="mt-2 flex items-center justify-center gap-2">
                <span className="text-lg text-amber-400">🛣️</span>
                <span className="text-sm text-white/60">
                  {activeRepairMinigame.road_class.charAt(0).toUpperCase() +
                    activeRepairMinigame.road_class.slice(1)}{" "}
                  Road
                </span>
                <span className="text-white/30">•</span>
                <span className="text-sm text-red-400">
                  {activeRepairMinigame.current_health}% → 100%
                </span>
              </div>
            </div>

            {/* Game area */}
            <div className="flex flex-1 items-center justify-center p-6">
              {activeRepairMinigame.minigame_type === "pothole_patrol" && (
                <PotholePatrol
                  config={activeRepairMinigame.config}
                  difficulty={activeRepairMinigame.difficulty}
                  onComplete={handleGameComplete}
                />
              )}
              {activeRepairMinigame.minigame_type === "road_roller" && (
                <RoadRoller
                  config={activeRepairMinigame.config}
                  difficulty={activeRepairMinigame.difficulty}
                  onComplete={handleGameComplete}
                />
              )}
              {activeRepairMinigame.minigame_type === "traffic_director" && (
                <TrafficDirector
                  config={activeRepairMinigame.config}
                  difficulty={activeRepairMinigame.difficulty}
                  onComplete={handleGameComplete}
                />
              )}
            </div>
          </div>
        ) : null}

        {/* Quit confirmation modal */}
        {showQuitConfirm && (
          <div className="absolute inset-0 z-20 flex items-center justify-center rounded-3xl bg-black/60 backdrop-blur-sm">
            <div className="mx-4 rounded-2xl border border-white/10 bg-[#1a1d21] p-6 text-center shadow-xl">
              <p className="text-lg font-semibold text-white">Quit Repair?</p>
              <p className="mt-2 text-sm text-white/60">
                You&apos;ll lose your progress and the road won&apos;t be repaired.
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
