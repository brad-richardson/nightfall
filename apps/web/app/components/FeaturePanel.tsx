"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Utensils, Wrench, Zap, Package, X, Rocket, Clock } from "lucide-react";
import { toast } from "sonner";
import { useStore, type UserVotes } from "../store";
import type { ResourceType } from "@nightfall/config";
import VoteButton from "./VoteButton";

type SelectedFeature = {
  gers_id: string;
  type: "road" | "building";
  position?: { x: number; y: number };
};

type Task = {
  task_id: string;
  target_gers_id: string;
  priority_score: number;
  status: string;
  vote_score: number;
};

type FeaturePanelProps = {
  onContribute: (sourceGersId: string, resourceType: ResourceType, amount: number) => void;
  onVote: (taskId: string, weight: number) => Promise<void>;
  onBoostProduction: (buildingGersId: string, buildingName: string) => void;
  activeTasks: Task[];
  canContribute: boolean;
  userVotes: UserVotes;
};

const PANEL_WIDTH = 320;
const PADDING = 16;

export default function FeaturePanel({ onContribute, onVote, onBoostProduction, activeTasks, canContribute, userVotes }: FeaturePanelProps) {
  const [selected, setSelected] = useState<SelectedFeature | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [panelPos, setPanelPos] = useState({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);
  const features = useStore((state) => state.features);
  const minigameCooldowns = useStore((state) => state.minigameCooldowns);
  const buildingBoosts = useStore((state) => state.buildingBoosts);

  useEffect(() => {
    const handleSelection = (e: Event) => {
      const customEvent = e as CustomEvent<SelectedFeature | null>;
      setSelected(customEvent.detail);
      if (!customEvent.detail) {
        setStatusMsg(null);
      }
    };

    window.addEventListener("nightfall:feature_selected", handleSelection);
    return () => window.removeEventListener("nightfall:feature_selected", handleSelection);
  }, []);

  // Calculate panel position based on click and viewport
  const calculatePosition = React.useCallback(() => {
    if (!selected?.position || !panelRef.current) return;

    const { x: clickX, y: clickY } = selected.position;
    const panelHeight = panelRef.current.offsetHeight || 300;

    // Get current viewport dimensions
    const vWidth = window.innerWidth;
    const vHeight = window.innerHeight;

    // On mobile (< 768px), center the panel horizontally near the bottom
    if (vWidth < 768) {
      const x = Math.max(PADDING, (vWidth - PANEL_WIDTH) / 2);
      const y = Math.min(vHeight - panelHeight - 100, vHeight * 0.4); // Upper portion of screen
      setPanelPos({ x, y });
      return;
    }

    // Default placement: to the right and centered vertically relative to click
    let x = clickX + 24;
    let y = clickY - panelHeight / 2;

    // If too far right, place to the left of click
    if (x + PANEL_WIDTH + PADDING > vWidth) {
      x = clickX - PANEL_WIDTH - 24;
    }

    // Horizontal bounds
    x = Math.max(PADDING, Math.min(x, vWidth - PANEL_WIDTH - PADDING));

    // Vertical bounds (account for header and footer areas)
    y = Math.max(PADDING + 80, Math.min(y, vHeight - panelHeight - PADDING - 60));

    setPanelPos({ x, y });
  }, [selected]);

  // Initial position calculation
  useLayoutEffect(() => {
    calculatePosition();
  }, [calculatePosition]);

  // Reposition on resize/orientation change
  useEffect(() => {
    if (!selected) return;

    const handleResize = () => {
      calculatePosition();
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    };
  }, [selected, calculatePosition]);

  const selectedDetails = useMemo(() => {
    if (!selected) return null;
    const feature = features.find((f) => f.gers_id === selected.gers_id);
    return feature ?? null;
  }, [features, selected]);

  const task = useMemo(() => {
    if (!selected) return null;
    return activeTasks.find(t => t.target_gers_id === selected.gers_id);
  }, [activeTasks, selected]);

  const canGenerateFood = selectedDetails?.generates_food ?? false;
  const canGenerateEquipment = selectedDetails?.generates_equipment ?? false;
  const canGenerateEnergy = selectedDetails?.generates_energy ?? false;
  const canGenerateMaterials = selectedDetails?.generates_materials ?? false;
  const hasAnyResource = canGenerateFood || canGenerateEquipment || canGenerateEnergy || canGenerateMaterials;
  const contributionDisabled = !canContribute || isSubmitting || !hasAnyResource;

  const handleContributeClick = (resourceType: ResourceType, amount: number) => {
    if (contributionDisabled || !selected) return;
    setIsSubmitting(true);
    setStatusMsg(null);
    Promise.resolve(onContribute(selected.gers_id, resourceType, amount))
      .then(() => {
        setStatusMsg("Convoy dispatched");
        const label = resourceType.charAt(0).toUpperCase() + resourceType.slice(1);
        toast.success(`+${amount} ${label} dispatched`, { description: "Convoy en route to the hub" });
      })
      .catch(() => {
        setStatusMsg("Contribution failed");
        toast.error("Contribution failed", { description: "Please try again" });
      })
      .finally(() => setIsSubmitting(false));
  };


  const isVisible = !!selected;

  return (
    <div 
      ref={panelRef}
      className={`absolute z-50 w-[320px] rounded-3xl border border-white/10 bg-[color:var(--night-ink)]/90 p-6 text-white shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl transition-all duration-300 ease-out ${
        isVisible ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
      }`}
      style={{
        left: panelPos.x,
        top: panelPos.y
      }}
    >
      <button 
        onClick={() => setSelected(null)}
        className="absolute right-4 top-4 rounded-full p-1 hover:bg-white/10 transition-colors"
        aria-label="Close panel"
      >
        <X className="h-4 w-4 text-white/40" />
      </button>

      {selected && (
        <div className="space-y-6">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[color:var(--night-teal)]">
              {selected.type}
            </p>
            <h2 className="mt-1 font-display text-xl">
              {selected.type === 'road' ? 'Road Segment' : (selectedDetails?.place_category || 'Building')}
            </h2>
            <p className="text-[10px] font-mono text-white/30 uppercase mt-1 overflow-hidden text-ellipsis">
              {selected.gers_id}
            </p>
          </div>

          {selected.type === 'building' && (
            <div className="space-y-4">
              {/* Boost Production Button */}
              {hasAnyResource && (() => {
                const cooldown = minigameCooldowns[selected.gers_id];
                const boost = buildingBoosts[selected.gers_id];
                const now = Date.now();
                const cooldownActive = cooldown && new Date(cooldown.available_at).getTime() > now;
                const boostActive = boost && new Date(boost.expires_at).getTime() > now;
                const cooldownRemaining = cooldownActive
                  ? Math.ceil((new Date(cooldown.available_at).getTime() - now) / 1000 / 60)
                  : 0;
                const boostRemaining = boostActive
                  ? Math.ceil((new Date(boost.expires_at).getTime() - now) / 1000 / 60)
                  : 0;

                return (
                  <div className="mb-2">
                    {boostActive ? (
                      <div className="rounded-2xl bg-gradient-to-r from-[color:var(--night-teal)]/20 to-transparent border border-[color:var(--night-teal)]/30 p-4">
                        <div className="flex items-center gap-3">
                          <Rocket className="h-5 w-5 text-[color:var(--night-teal)]" />
                          <div className="flex-1">
                            <p className="text-sm font-medium text-white">
                              {boost.multiplier}× Boost Active
                            </p>
                            <p className="text-xs text-white/50">
                              {boostRemaining}m remaining
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : cooldownActive ? (
                      <button
                        disabled
                        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white/5 p-3 text-white/40 cursor-not-allowed"
                      >
                        <Clock className="h-4 w-4" />
                        <span className="text-sm">Cooldown: {cooldownRemaining}m</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => onBoostProduction(selected.gers_id, selectedDetails?.place_category || 'Building')}
                        disabled={!canContribute}
                        className={`flex w-full items-center justify-center gap-2 rounded-2xl p-3 transition-all ${
                          canContribute
                            ? "bg-gradient-to-r from-[color:var(--night-teal)] to-[#4ade80] text-white shadow-[0_4px_16px_rgba(45,212,191,0.3)] hover:brightness-110 active:scale-95"
                            : "bg-white/10 text-white/40 cursor-not-allowed"
                        }`}
                      >
                        <Rocket className="h-4 w-4" />
                        <span className="text-sm font-semibold uppercase tracking-wider">Boost Production</span>
                      </button>
                    )}
                  </div>
                );
              })()}

              <p className="text-xs leading-relaxed text-white/60">
                Activate this building to send recurring convoys to the regional hub for the next 2 minutes.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {canGenerateFood && (
                  <button
                    onClick={() => handleContributeClick("food", 100)}
                    disabled={contributionDisabled}
                    className={`flex flex-col items-center rounded-2xl p-3 transition-all ${
                      contributionDisabled
                        ? "bg-white/5 text-white/30 cursor-not-allowed opacity-50"
                        : "bg-white/5 hover:bg-white/10 active:scale-95"
                    }`}
                  >
                    <Utensils className="mb-2 h-5 w-5 text-[#4ade80]" />
                    <span className="text-[10px] font-bold uppercase text-white/40">Food</span>
                    <span className="text-xs font-bold">Start Convoy</span>
                  </button>
                )}
                {canGenerateEquipment && (
                  <button
                    onClick={() => handleContributeClick("equipment", 100)}
                    disabled={contributionDisabled}
                    className={`flex flex-col items-center rounded-2xl p-3 transition-all ${
                      contributionDisabled
                        ? "bg-white/5 text-white/30 cursor-not-allowed opacity-50"
                        : "bg-white/5 hover:bg-white/10 active:scale-95"
                    }`}
                  >
                    <Wrench className="mb-2 h-5 w-5 text-[#f97316]" />
                    <span className="text-[10px] font-bold uppercase text-white/40">Equipment</span>
                    <span className="text-xs font-bold">Start Convoy</span>
                  </button>
                )}
                {canGenerateEnergy && (
                  <button
                    onClick={() => handleContributeClick("energy", 100)}
                    disabled={contributionDisabled}
                    className={`flex flex-col items-center rounded-2xl p-3 transition-all ${
                      contributionDisabled
                        ? "bg-white/5 text-white/30 cursor-not-allowed opacity-50"
                        : "bg-white/5 hover:bg-white/10 active:scale-95"
                    }`}
                  >
                    <Zap className="mb-2 h-5 w-5 text-[#facc15]" />
                    <span className="text-[10px] font-bold uppercase text-white/40">Energy</span>
                    <span className="text-xs font-bold">Start Convoy</span>
                  </button>
                )}
                {canGenerateMaterials && (
                  <button
                    onClick={() => handleContributeClick("materials", 100)}
                    disabled={contributionDisabled}
                    className={`flex flex-col items-center rounded-2xl p-3 transition-all ${
                      contributionDisabled
                        ? "bg-white/5 text-white/30 cursor-not-allowed opacity-50"
                        : "bg-white/5 hover:bg-white/10 active:scale-95"
                    }`}
                  >
                    <Package className="mb-2 h-5 w-5 text-[#818cf8]" />
                    <span className="text-[10px] font-bold uppercase text-white/40">Materials</span>
                    <span className="text-xs font-bold">Start Convoy</span>
                  </button>
                )}
              </div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-white/40 h-4">
                {isSubmitting
                  ? "Sending..."
                  : !hasAnyResource
                    ? "Building does not generate resources"
                    : canContribute
                      ? statusMsg ?? "Tap to activate"
                      : "Authorizing..."}
              </div>
            </div>
          )}

          {selected.type === 'road' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-xs text-white/40">Health</span>
                <span className="text-xs font-bold" style={{ color: `hsl(${Math.round(selectedDetails?.health ?? 100)}, 70%, 60%)` }}>
                  {Math.round(selectedDetails?.health ?? 100)}%
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
                <div 
                  className="h-full bg-[color:var(--night-teal)] transition-all duration-500" 
                  style={{ width: `${selectedDetails?.health ?? 100}%` }} 
                />
              </div>

              {task ? (
                <div className="rounded-2xl bg-[color:var(--night-teal)]/10 p-4 border border-[color:var(--night-teal)]/20 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--night-teal)] mb-3">Active Task</p>
                  <div className="flex flex-col gap-3">
                    <span className="text-xs text-white/80 font-medium">Repair needed - vote to prioritize</span>
                    <VoteButton
                      taskId={task.task_id}
                      currentVoteScore={task.vote_score}
                      userVote={userVotes[task.task_id]}
                      onVote={onVote}
                      size="md"
                    />
                  </div>
                </div>
              ) : (
                <p className="text-xs text-white/40 italic">This road is currently stable. No active tasks.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
