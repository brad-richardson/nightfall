"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { X, Rocket, Clock, Play, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useStore, type UserVotes } from "../store";
import VoteButton from "./VoteButton";
import { BUILDING_ACTIVATION_MS } from "@nightfall/config";

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
  onActivateBuilding: (buildingGersId: string) => Promise<{ activated_at: string; expires_at: string }>;
  onVote: (taskId: string, weight: number) => Promise<void>;
  onBoostProduction: (buildingGersId: string, buildingName: string) => void;
  activeTasks: Task[];
  canContribute: boolean;
  userVotes: UserVotes;
};

const PANEL_WIDTH = 320;
const PADDING = 16;

export default function FeaturePanel({ onActivateBuilding, onVote, onBoostProduction, activeTasks, canContribute, userVotes }: FeaturePanelProps) {
  const [selected, setSelected] = useState<SelectedFeature | null>(null);
  const [isActivating, setIsActivating] = useState(false);
  const [panelPos, setPanelPos] = useState({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);
  const features = useStore((state) => state.features);
  const buildingBoosts = useStore((state) => state.buildingBoosts);
  const buildingActivations = useStore((state) => state.buildingActivations);
  const addBuildingActivation = useStore((state) => state.addBuildingActivation);

  useEffect(() => {
    const handleSelection = (e: Event) => {
      const customEvent = e as CustomEvent<SelectedFeature | null>;
      setSelected(customEvent.detail);
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

  // Get resource types this building generates
  const resourceTypes = useMemo(() => {
    const types: string[] = [];
    if (canGenerateFood) types.push("Food");
    if (canGenerateEquipment) types.push("Equipment");
    if (canGenerateEnergy) types.push("Energy");
    if (canGenerateMaterials) types.push("Materials");
    return types;
  }, [canGenerateFood, canGenerateEquipment, canGenerateEnergy, canGenerateMaterials]);

  // Check if building is currently activated
  // First check the store, then fall back to the feature's last_activated_at from the API
  const activationState = useMemo(() => {
    if (!selected) return null;
    const now = Date.now();

    // Check store first (most up-to-date)
    const storeActivation = buildingActivations[selected.gers_id];
    if (storeActivation) {
      const expiresAt = new Date(storeActivation.expires_at).getTime();
      if (expiresAt > now) {
        return {
          ...storeActivation,
          remainingMs: expiresAt - now,
          remainingSeconds: Math.ceil((expiresAt - now) / 1000)
        };
      }
    }

    // Fall back to feature's last_activated_at from API
    if (selectedDetails?.last_activated_at) {
      const activatedAt = new Date(selectedDetails.last_activated_at).getTime();
      const expiresAt = activatedAt + BUILDING_ACTIVATION_MS;
      if (expiresAt > now) {
        return {
          building_gers_id: selected.gers_id,
          activated_at: selectedDetails.last_activated_at,
          expires_at: new Date(expiresAt).toISOString(),
          remainingMs: expiresAt - now,
          remainingSeconds: Math.ceil((expiresAt - now) / 1000)
        };
      }
    }

    return null;
  }, [selected, buildingActivations, selectedDetails]);

  const isActivated = !!activationState;

  const handleActivateClick = async () => {
    if (!selected || !canContribute || isActivating || isActivated) return;
    setIsActivating(true);
    try {
      const result = await onActivateBuilding(selected.gers_id);
      addBuildingActivation({
        building_gers_id: selected.gers_id,
        activated_at: result.activated_at,
        expires_at: result.expires_at
      });
      toast.success("Building activated!", { description: "Convoys will be dispatched for the next 2 minutes" });
    } catch {
      toast.error("Activation failed", { description: "Please try again" });
    } finally {
      setIsActivating(false);
    }
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
        <div className="space-y-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[color:var(--night-teal)]">
              {selected.type}
            </p>
            {selected.type === 'road' && (
              <h2 className="mt-1 font-display text-xl">Road Segment</h2>
            )}
            <p className="text-[10px] font-mono text-white/30 uppercase mt-1 overflow-hidden text-ellipsis">
              {selected.gers_id}
            </p>
          </div>

          {selected.type === 'building' && (
            <div className="space-y-3">
              {hasAnyResource ? (
                <>
                  {/* Resource types indicator */}
                  <div className="flex flex-wrap gap-2">
                    {resourceTypes.map((type) => (
                      <span
                        key={type}
                        className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/60"
                      >
                        {type}
                      </span>
                    ))}
                  </div>

                  {/* Activation status */}
                  {isActivated && (
                    <div className="rounded-2xl bg-gradient-to-r from-green-500/20 to-transparent border border-green-500/30 p-4">
                      <div className="flex items-center gap-3">
                        <CheckCircle2 className="h-5 w-5 text-green-400" />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-white">
                            Building Active
                          </p>
                          <p className="text-xs text-white/50">
                            Convoys running • {Math.ceil((activationState?.remainingSeconds ?? 0) / 60)}m remaining
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Boost status */}
                  {(() => {
                    const boost = buildingBoosts[selected.gers_id];
                    const now = Date.now();
                    const boostActive = boost && new Date(boost.expires_at).getTime() > now;
                    const boostRemaining = boostActive
                      ? Math.ceil((new Date(boost.expires_at).getTime() - now) / 1000 / 60)
                      : 0;

                    if (boostActive) {
                      return (
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
                      );
                    }
                    return null;
                  })()}

                  <p className="text-xs leading-relaxed text-white/60">
                    Activate this building to send recurring convoys to the regional hub for 2 minutes.
                    Play the minigame for a boosted activation with increased resource generation.
                  </p>

                  {/* Action buttons */}
                  <div className="flex flex-col gap-3">
                    {/* Activate button - grayed out if already activated */}
                    <button
                      onClick={handleActivateClick}
                      disabled={!canContribute || isActivating || isActivated}
                      className={`flex w-full items-center justify-center gap-2 rounded-2xl p-3 transition-all ${
                        isActivated
                          ? "bg-green-500/10 text-green-400/60 cursor-not-allowed border border-green-500/20"
                          : !canContribute || isActivating
                            ? "bg-white/5 text-white/40 cursor-not-allowed"
                            : "bg-white/10 hover:bg-white/15 text-white active:scale-95"
                      }`}
                    >
                      {isActivated ? (
                        <>
                          <CheckCircle2 className="h-4 w-4" />
                          <span className="text-sm font-semibold">Already Active</span>
                        </>
                      ) : isActivating ? (
                        <>
                          <Clock className="h-4 w-4 animate-spin" />
                          <span className="text-sm font-semibold">Activating...</span>
                        </>
                      ) : (
                        <>
                          <Play className="h-4 w-4" />
                          <span className="text-sm font-semibold uppercase tracking-wider">Activate</span>
                        </>
                      )}
                    </button>

                    {/* Boost button - always available */}
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
                  </div>

                </>
              ) : (
                <p className="text-xs text-white/40 italic">
                  This building does not generate resources.
                </p>
              )}
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
