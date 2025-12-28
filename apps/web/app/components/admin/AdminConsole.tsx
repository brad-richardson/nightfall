"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { useStore, type Phase } from "../../store";

type ResourceType = "food" | "equipment" | "energy" | "materials";

const RESOURCE_KEYS: ResourceType[] = ["food", "equipment", "energy", "materials"];

const PHASE_OPTIONS: Phase[] = ["dawn", "day", "dusk", "night"];

export function AdminConsole() {
  const [isOpen, setIsOpen] = useState(false);
  const region = useStore((s) => s.region);
  const cycle = useStore((s) => s.cycle);
  const setRegion = useStore((s) => s.setRegion);
  const setCycle = useStore((s) => s.setCycle);

  // Resource editing state
  const [resourceEdits, setResourceEdits] = useState<Record<ResourceType, string>>({
    food: "",
    equipment: "",
    energy: "",
    materials: "",
  });

  // Demo mode state
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [tickMultiplier, setTickMultiplier] = useState("1");
  const [cycleSpeed, setCycleSpeedState] = useState("1");

  const handleResourceChange = (type: ResourceType, value: string) => {
    setResourceEdits((prev) => ({ ...prev, [type]: value }));
  };

  const applyResources = useCallback(async () => {
    const updates: Partial<Record<ResourceType, number>> = {};

    for (const key of RESOURCE_KEYS) {
      const value = resourceEdits[key].trim();
      if (value !== "") {
        const num = parseFloat(value);
        if (!isNaN(num) && num >= 0) {
          updates[key] = num;
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      toast.error("No valid resource values to update");
      return;
    }

    try {
      const response = await fetch("/api/admin/set-resources", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_ADMIN_SECRET || "dev-secret"}`,
        },
        body: JSON.stringify({
          region_id: region.region_id,
          ...updates,
        }),
      });

      const data = await response.json();

      if (data.ok) {
        // Update local state
        setRegion((prev) => ({
          ...prev,
          pool_food: updates.food ?? prev.pool_food,
          pool_equipment: updates.equipment ?? prev.pool_equipment,
          pool_energy: updates.energy ?? prev.pool_energy,
          pool_materials: updates.materials ?? prev.pool_materials,
        }));
        toast.success("Resources updated");
        setResourceEdits({ food: "", equipment: "", energy: "", materials: "" });
      } else {
        toast.error(data.error || "Failed to update resources");
      }
    } catch {
      toast.error("Failed to update resources");
    }
  }, [resourceEdits, region.region_id, setRegion]);

  const fillResources = useCallback(async (amount: number) => {
    try {
      const response = await fetch("/api/admin/set-resources", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_ADMIN_SECRET || "dev-secret"}`,
        },
        body: JSON.stringify({
          region_id: region.region_id,
          food: amount,
          equipment: amount,
          energy: amount,
          materials: amount,
        }),
      });

      const data = await response.json();

      if (data.ok) {
        setRegion((prev) => ({
          ...prev,
          pool_food: amount,
          pool_equipment: amount,
          pool_energy: amount,
          pool_materials: amount,
        }));
        toast.success(`All resources set to ${amount}`);
      } else {
        toast.error(data.error || "Failed to update resources");
      }
    } catch {
      toast.error("Failed to update resources");
    }
  }, [region.region_id, setRegion]);

  const toggleDemoMode = useCallback(async () => {
    const newEnabled = !demoEnabled;

    try {
      const response = await fetch("/api/admin/demo-mode", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_ADMIN_SECRET || "dev-secret"}`,
        },
        body: JSON.stringify({
          enabled: newEnabled,
          tick_multiplier: parseFloat(tickMultiplier) || 1,
          cycle_speed: parseFloat(cycleSpeed) || 1,
        }),
      });

      const data = await response.json();

      if (data.ok) {
        setDemoEnabled(newEnabled);
        toast.success(`Demo mode ${newEnabled ? "enabled" : "disabled"}`);
      } else {
        toast.error(data.error || "Failed to toggle demo mode");
      }
    } catch {
      toast.error("Failed to toggle demo mode");
    }
  }, [demoEnabled, tickMultiplier, cycleSpeed]);

  const triggerReset = useCallback(async () => {
    if (!confirm("Are you sure you want to trigger a world reset? This will reset all game state.")) {
      return;
    }

    try {
      const response = await fetch("/api/admin/reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_ADMIN_SECRET || "dev-secret"}`,
        },
      });

      const data = await response.json();

      if (data.ok) {
        toast.success("World reset scheduled");
      } else {
        toast.error(data.error || "Failed to trigger reset");
      }
    } catch {
      toast.error("Failed to trigger reset");
    }
  }, []);

  const setPhase = useCallback(async (phase: Phase) => {
    try {
      const response = await fetch("/api/admin/set-phase", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_ADMIN_SECRET || "dev-secret"}`,
        },
        body: JSON.stringify({ phase }),
      });

      const data = await response.json();

      if (data.ok) {
        setCycle((prev) => ({ ...prev, phase, lastUpdated: Date.now() }));
        toast.success(`Phase set to ${phase}`);
      } else {
        toast.error(data.error || "Failed to set phase");
      }
    } catch {
      toast.error("Failed to set phase");
    }
  }, [setCycle]);

  const damageAllRoads = useCallback(async (healthValue: number) => {
    try {
      const response = await fetch("/api/admin/set-road-health", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_ADMIN_SECRET || "dev-secret"}`,
        },
        body: JSON.stringify({
          region_id: region.region_id,
          health: healthValue,
        }),
      });

      const data = await response.json();

      if (data.ok) {
        toast.success(`Road health set to ${healthValue}%`);
      } else {
        toast.error(data.error || "Failed to update road health");
      }
    } catch {
      toast.error("Failed to update road health");
    }
  }, [region.region_id]);

  const spreadRust = useCallback(async (level: number) => {
    try {
      const response = await fetch("/api/admin/set-rust", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_ADMIN_SECRET || "dev-secret"}`,
        },
        body: JSON.stringify({
          region_id: region.region_id,
          rust_level: level,
        }),
      });

      const data = await response.json();

      if (data.ok) {
        toast.success(`Rust level set to ${Math.round(level * 100)}%`);
      } else {
        toast.error(data.error || "Failed to update rust");
      }
    } catch {
      toast.error("Failed to update rust");
    }
  }, [region.region_id]);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-amber-600 text-white shadow-lg transition-transform hover:scale-110 hover:bg-amber-500"
        title="Admin Console"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-6 w-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
        </svg>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/20 bg-[rgba(12,16,20,0.95)] p-6 shadow-2xl">
        <button
          onClick={() => setIsOpen(false)}
          className="absolute right-4 top-4 text-white/60 transition-colors hover:text-white"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-6 w-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <h2 className="mb-6 font-[family-name:var(--font-display)] text-2xl text-white">Admin Console</h2>

        {/* Current State Display */}
        <div className="mb-6 rounded-xl bg-white/5 p-4">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-white/60">Current State</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-white/60">Region:</span>{" "}
              <span className="text-white">{region.name || region.region_id}</span>
            </div>
            <div>
              <span className="text-white/60">Phase:</span>{" "}
              <span className="capitalize text-white">{cycle.phase}</span>
            </div>
            <div>
              <span className="text-white/60">Active Crews:</span>{" "}
              <span className="text-white">{region.crews.filter((c) => c.status !== "idle").length}/{region.crews.length}</span>
            </div>
            <div>
              <span className="text-white/60">Tasks:</span>{" "}
              <span className="text-white">{region.tasks.length}</span>
            </div>
          </div>
        </div>

        {/* Resources Section */}
        <div className="mb-6 rounded-xl bg-white/5 p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/60">Resources</h3>

          <div className="mb-4 grid grid-cols-4 gap-2">
            {RESOURCE_KEYS.map((key) => (
              <div key={key} className="flex flex-col">
                <label className="mb-1 text-xs capitalize text-white/60">{key}</label>
                <div className="mb-1 text-xs text-white/40">
                  Current: {Math.round(region[`pool_${key}` as keyof typeof region] as number)}
                </div>
                <input
                  type="number"
                  value={resourceEdits[key]}
                  onChange={(e) => handleResourceChange(key, e.target.value)}
                  placeholder="Set value"
                  className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/40 focus:border-amber-500 focus:outline-none"
                />
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={applyResources}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-500"
            >
              Apply Changes
            </button>
            <button
              onClick={() => fillResources(10000)}
              className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
            >
              Fill 10k
            </button>
            <button
              onClick={() => fillResources(1000)}
              className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
            >
              Fill 1k
            </button>
            <button
              onClick={() => fillResources(0)}
              className="rounded-lg bg-red-600/50 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500/50"
            >
              Empty All
            </button>
          </div>
        </div>

        {/* Day/Night Cycle Section */}
        <div className="mb-6 rounded-xl bg-white/5 p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/60">Day/Night Cycle</h3>

          <div className="flex flex-wrap gap-2">
            {PHASE_OPTIONS.map((phase) => (
              <button
                key={phase}
                onClick={() => setPhase(phase)}
                className={`rounded-lg px-4 py-2 text-sm font-medium capitalize transition-colors ${
                  cycle.phase === phase
                    ? "bg-[color:var(--night-teal)] text-white"
                    : "bg-white/10 text-white hover:bg-white/20"
                }`}
              >
                {phase}
              </button>
            ))}
          </div>
        </div>

        {/* World State Section */}
        <div className="mb-6 rounded-xl bg-white/5 p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/60">World State</h3>

          <div className="mb-4 grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs text-white/60">Road Health</label>
              <div className="flex gap-2">
                <button
                  onClick={() => damageAllRoads(100)}
                  className="rounded-lg bg-green-600/50 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-green-500/50"
                >
                  100%
                </button>
                <button
                  onClick={() => damageAllRoads(50)}
                  className="rounded-lg bg-yellow-600/50 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-yellow-500/50"
                >
                  50%
                </button>
                <button
                  onClick={() => damageAllRoads(20)}
                  className="rounded-lg bg-red-600/50 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-red-500/50"
                >
                  20%
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-white/60">Rust Level</label>
              <div className="flex gap-2">
                <button
                  onClick={() => spreadRust(0)}
                  className="rounded-lg bg-green-600/50 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-green-500/50"
                >
                  Clear
                </button>
                <button
                  onClick={() => spreadRust(0.5)}
                  className="rounded-lg bg-yellow-600/50 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-yellow-500/50"
                >
                  50%
                </button>
                <button
                  onClick={() => spreadRust(1.0)}
                  className="rounded-lg bg-red-600/50 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-red-500/50"
                >
                  100%
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Demo Mode Section */}
        <div className="mb-6 rounded-xl bg-white/5 p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/60">Demo Mode</h3>

          <div className="mb-4 grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs text-white/60">Tick Multiplier</label>
              <input
                type="number"
                value={tickMultiplier}
                onChange={(e) => setTickMultiplier(e.target.value)}
                className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/60">Cycle Speed</label>
              <input
                type="number"
                value={cycleSpeed}
                onChange={(e) => setCycleSpeedState(e.target.value)}
                className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
              />
            </div>
          </div>

          <button
            onClick={toggleDemoMode}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              demoEnabled
                ? "bg-green-600 text-white hover:bg-green-500"
                : "bg-white/10 text-white hover:bg-white/20"
            }`}
          >
            {demoEnabled ? "Demo Mode ON" : "Demo Mode OFF"}
          </button>
        </div>

        {/* Danger Zone */}
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-red-400">Danger Zone</h3>

          <button
            onClick={triggerReset}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500"
          >
            Trigger World Reset
          </button>
        </div>
      </div>
    </div>
  );
}
