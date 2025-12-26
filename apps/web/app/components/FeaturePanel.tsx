"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Hammer, Package, Vote, X } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../store";

type SelectedFeature = {
  gers_id: string;
  type: "road" | "building";
};

type Task = {
  task_id: string;
  target_gers_id: string;
  priority_score: number;
  status: string;
  vote_score: number;
};

type FeaturePanelProps = {
  onContribute: (labor: number, materials: number) => void;
  onVote: (taskId: string, weight: number) => void;
  activeTasks: Task[];
  canContribute: boolean;
};

export default function FeaturePanel({ onContribute, onVote, activeTasks, canContribute }: FeaturePanelProps) {
  const [selected, setSelected] = useState<SelectedFeature | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const features = useStore((state) => state.features);

  useEffect(() => {
    const handleSelection = (e: Event) => {
      const customEvent = e as CustomEvent<SelectedFeature | null>;
      setSelected(customEvent.detail);
    };

    window.addEventListener("nightfall:feature_selected", handleSelection);
    return () => window.removeEventListener("nightfall:feature_selected", handleSelection);
  }, []);

  const selectedDetails = useMemo(() => {
    if (!selected) return null;
    const feature = features.find((f) => f.gers_id === selected.gers_id);
    return feature ?? null;
  }, [features, selected]);

  if (!selected) return null;

  const task = activeTasks.find(t => t.target_gers_id === selected.gers_id);
  const canGenerateLabor = selectedDetails?.generates_labor ?? false;
  const canGenerateMaterials = selectedDetails?.generates_materials ?? false;
  const contributionDisabled = !canContribute || isSubmitting || (!canGenerateLabor && !canGenerateMaterials);

  const handleContributeClick = (labor: number, materials: number) => {
    if (contributionDisabled) return;
    setIsSubmitting(true);
    setStatusMsg(null);
    Promise.resolve(onContribute(labor, materials))
      .then(() => {
        setStatusMsg("Contribution sent");
        toast.success(
          labor > 0 ? `+${labor} Labor contributed` : `+${materials} Materials contributed`,
          { description: "Resources added to regional pool" }
        );
      })
      .catch(() => {
        setStatusMsg("Contribution failed");
        toast.error("Contribution failed", { description: "Please try again" });
      })
      .finally(() => setIsSubmitting(false));
  };

  const handleVoteClick = (taskId: string) => {
    onVote(taskId, 1);
    toast.success("Vote cast", { description: "Your vote helps prioritize repairs" });
  };

  return (
    <div className="absolute z-20 left-4 right-4 bottom-4 md:left-auto md:bottom-auto md:right-6 md:top-24 md:w-80 rounded-3xl border border-white/10 bg-[color:var(--night-ink)]/90 p-6 text-white shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl">
      <button 
        onClick={() => setSelected(null)}
        className="absolute right-4 top-4 rounded-full p-1 hover:bg-white/10"
      >
        <X className="h-4 w-4 text-white/40" />
      </button>

      <div className="space-y-6">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[color:var(--night-teal)]">
            {selected.type}
          </p>
          <h2 className="mt-1 font-display text-xl">
            {selected.type === 'road' ? 'Road Segment' : 'Building'}
          </h2>
          <p className="text-[10px] font-mono text-white/30 uppercase mt-1">
            {selected.gers_id}
          </p>
        </div>

        {selected.type === 'building' && (
          <div className="space-y-4">
            <p className="text-xs leading-relaxed text-white/60">
              Contribute resources to the regional pool from this building.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={() => handleContributeClick(10, 0)}
                disabled={contributionDisabled || !canGenerateLabor}
                className={`flex flex-col items-center rounded-2xl p-3 transition-colors ${
                  contributionDisabled || !canGenerateLabor
                    ? "bg-white/5 text-white/30 cursor-not-allowed"
                    : "bg-white/5 hover:bg-white/10"
                }`}
              >
                <Hammer className="mb-2 h-5 w-5 text-[color:var(--night-teal)]" />
                <span className="text-[10px] font-bold uppercase text-white/40">Add Labor</span>
                <span className="text-xs font-bold">+10</span>
              </button>
              <button 
                onClick={() => handleContributeClick(0, 10)}
                disabled={contributionDisabled || !canGenerateMaterials}
                className={`flex flex-col items-center rounded-2xl p-3 transition-colors ${
                  contributionDisabled || !canGenerateMaterials
                    ? "bg-white/5 text-white/30 cursor-not-allowed"
                    : "bg-white/5 hover:bg-white/10"
                }`}
              >
                <Package className="mb-2 h-5 w-5 text-[color:var(--night-glow)]" />
                <span className="text-[10px] font-bold uppercase text-white/40">Add Materials</span>
                <span className="text-xs font-bold">+10</span>
              </button>
            </div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-white/40">
              {isSubmitting
                ? "Sending..."
                : contributionDisabled && !canGenerateLabor && !canGenerateMaterials
                  ? "This building does not generate resources"
                  : canContribute
                    ? statusMsg ?? "Tap to contribute"
                    : "Authorizing..."}
            </div>
          </div>
        )}

        {selected.type === 'road' && (
          <div className="space-y-4">
            {task ? (
              <div className="rounded-2xl bg-[color:var(--night-teal)]/10 p-4 border border-[color:var(--night-teal)]/20">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--night-teal)] mb-2">Active Task</p>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-white/80 font-medium">Repair needed</span>
                  <button
                    onClick={() => handleVoteClick(task.task_id)}
                    className="flex items-center gap-2 rounded-full bg-[color:var(--night-teal)] px-3 py-1.5 text-xs font-bold text-white shadow-[0_0_15px_rgba(44,101,117,0.4)] transition-transform active:scale-95"
                  >
                    <Vote className="h-3.5 w-3.5" />
                    Vote
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-white/40 italic">This road is currently stable. No active tasks.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
