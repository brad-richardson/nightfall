"use client";

import React, { useEffect, useState } from "react";
import { Hammer, Package, Vote, X } from "lucide-react";

type SelectedFeature = {
  gers_id: string;
  type: "road" | "building";
};

type FeatureDetails = {
  gers_id: string;
  feature_type: string;
  health?: number;
  status?: string;
  road_class?: string;
  place_category?: string;
  generates_labor?: boolean;
  generates_materials?: boolean;
};

type FeaturePanelProps = {
  onContribute: (labor: number, materials: number) => void;
  onVote: (taskId: string, weight: number) => void;
  activeTasks: any[];
};

export default function FeaturePanel({ onContribute, onVote, activeTasks }: FeaturePanelProps) {
  const [selected, setSelected] = useState<SelectedFeature | null>(null);
  const [details, setDetails] = useState<FeatureDetails | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handleSelection = (e: CustomEvent<SelectedFeature | null>) => {
      setSelected(e.detail);
    };

    window.addEventListener("nightfall:feature_selected" as any, handleSelection);
    return () => window.removeEventListener("nightfall:feature_selected" as any, handleSelection);
  }, []);

  useEffect(() => {
    if (!selected) {
      setDetails(null);
      return;
    }

    // In a real app, we'd fetch details from API
    // For now, we'll try to find it in our current state or show basic info
    setDetails({
      gers_id: selected.gers_id,
      feature_type: selected.type
    });
  }, [selected]);

  if (!selected) return null;

  const task = activeTasks.find(t => t.target_gers_id === selected.gers_id);

  return (
    <div className="absolute right-6 top-24 z-20 w-80 rounded-3xl border border-white/10 bg-[color:var(--night-ink)]/90 p-6 text-white shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl">
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
                onClick={() => onContribute(10, 0)}
                className="flex flex-col items-center rounded-2xl bg-white/5 p-3 transition-colors hover:bg-white/10"
              >
                <Hammer className="mb-2 h-5 w-5 text-[color:var(--night-teal)]" />
                <span className="text-[10px] font-bold uppercase text-white/40">Add Labor</span>
                <span className="text-xs font-bold">+10</span>
              </button>
              <button 
                onClick={() => onContribute(0, 10)}
                className="flex flex-col items-center rounded-2xl bg-white/5 p-3 transition-colors hover:bg-white/10"
              >
                <Package className="mb-2 h-5 w-5 text-[color:var(--night-glow)]" />
                <span className="text-[10px] font-bold uppercase text-white/40">Add Materials</span>
                <span className="text-xs font-bold">+10</span>
              </button>
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
                    onClick={() => onVote(task.task_id, 1)}
                    className="flex items-center gap-2 rounded-full bg-[color:var(--night-teal)] px-3 py-1.5 text-xs font-bold text-white shadow-[0_0_15px_rgba(44,101,117,0.4)]"
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
