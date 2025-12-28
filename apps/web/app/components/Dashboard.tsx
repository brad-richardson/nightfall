"use client";

import { useState, useMemo, useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import DemoMap from "./DemoMap";
import PhaseIndicator from "./PhaseIndicator";
import TaskList from "./TaskList";
import FeaturePanel from "./FeaturePanel";
import MobileSidebar from "./MobileSidebar";
import RegionalHealthRing from "./RegionalHealthRing";
import { MapOverlay } from "./MapOverlay";
import { useEventStream, type EventPayload } from "../hooks/useEventStream";
import { useStore, type Region, type Feature, type Hex, type CycleState } from "../store";
import { BAR_HARBOR_DEMO_BBOX, DEGRADED_HEALTH_THRESHOLD } from "@nightfall/config";
import { fetchWithRetry } from "../lib/retry";
import { formatNumber } from "../lib/formatters";
import { ResourcePoolsPanel } from "./sidebar/ResourcePoolsPanel";
import { RegionHealthPanel } from "./sidebar/RegionHealthPanel";
import { OnboardingOverlay } from "./OnboardingOverlay";
import { recordResourceValues, clearResourceHistory } from "../lib/resourceHistory";

type ResourceType = "food" | "equipment" | "energy" | "materials";

type ResourceDelta = {
  type: ResourceType;
  delta: number;
  source: string;
  ts: number;
};

type PathWaypoint = {
  coord: [number, number];
  arrive_at: string;
};

type ResourceTransferPayload = {
  transfer_id: string;
  region_id: string;
  source_gers_id: string | null;
  hub_gers_id: string | null;
  resource_type: ResourceType;
  amount: number;
  depart_at: string;
  arrive_at: string;
  path_waypoints?: PathWaypoint[] | null;
};

type DashboardProps = {
  initialRegion: Region;
  initialFeatures: Feature[];
  initialHexes: Hex[];
  initialCycle: CycleState;
  availableRegions: { region_id: string; name: string }[];
  isDemoMode: boolean;
  apiBaseUrl: string;
  pmtilesRelease: string;
};

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const FETCH_RETRY_OPTIONS = { attempts: 3, baseDelayMs: 250, maxDelayMs: 2000, jitter: 0.2 };

const RESOURCE_LABELS: Record<ResourceType, string> = {
  food: "Food",
  equipment: "Equipment",
  energy: "Energy",
  materials: "Materials"
};

function ResourceTicker({ deltas }: { deltas: ResourceDelta[] }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-white/20 bg-[rgba(12,16,20,0.45)] px-4 py-3 shadow-[0_12px_30px_rgba(0,0,0,0.35)] backdrop-blur-md">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-white/60">
        <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-[color:var(--night-teal)] shadow-[0_0_8px_var(--night-teal)]" />
        Resource Events
      </div>
      <div className="space-y-1">
        {deltas.length === 0 ? (
          <div className="text-[11px] text-white/40">Awaiting activity...</div>
        ) : (
          deltas.slice(0, 4).map((item, idx) => (
            <div
              key={item.ts + idx}
              className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-[11px] text-white/80 animate-[fade-in_400ms_ease]"
            >
              <div className="flex items-center gap-2">
                <span className={`h-6 w-6 rounded-lg bg-gradient-to-br ${item.delta > 0 ? "from-[color:var(--night-teal)]/70 to-[color:var(--night-glow)]/60" : "from-red-500/60 to-orange-400/50"} text-xs font-bold text-white shadow-[0_0_12px_rgba(0,0,0,0.35)] flex items-center justify-center`}>
                  {item.delta > 0 ? "+" : "−"}
                </span>
                <div className="leading-tight">
                  <div className="font-semibold">
                    {RESOURCE_LABELS[item.type]} {item.delta > 0 ? "added" : "spent"} {Math.abs(Math.round(item.delta))}
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-white/40">{item.source}</div>
                </div>
              </div>
              <span className="text-[10px] text-white/40">
                {new Date(item.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function MapPanel({
  title,
  children,
  className
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col rounded-2xl border border-white/10 bg-[#0f1216]/60 p-4 text-white shadow-[0_12px_30px_rgba(0,0,0,0.45)] backdrop-blur-md${className ? ` ${className}` : ""}`}
    >
      {title ? (
        <p className="shrink-0 text-[10px] uppercase tracking-[0.35em] text-white/50">
          {title}
        </p>
      ) : null}
      <div className={`min-h-0 flex-1${title ? " mt-3" : ""}`}>{children}</div>
    </div>
  );
}

async function initializeSession(apiBaseUrl: string): Promise<{ clientId: string; token: string }> {
  let clientId = typeof window !== 'undefined' ? localStorage.getItem("nightfall_client_id") : null;
  if (!clientId) {
    clientId = `client_${Math.random().toString(36).slice(2, 11)}`;
    if (typeof window !== 'undefined') localStorage.setItem("nightfall_client_id", clientId);
  }

  try {
    const res = await fetchWithRetry(`${apiBaseUrl}/api/hello`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId })
    }, FETCH_RETRY_OPTIONS);
    
    if (res.ok) {
      const data = await res.json();
      return { clientId, token: data.token };
    }
  } catch (err) {
    console.error("Session init failed", err);
  }
  
  return { clientId, token: "" };
}

export default function Dashboard({
  initialRegion,
  initialFeatures,
  initialHexes,
  initialCycle,
  availableRegions,
  isDemoMode,
  apiBaseUrl,
  pmtilesRelease
}: DashboardProps) {
  const router = useRouter();
  
  // Store hooks - only subscribe to state values, not actions
  const region = useStore((state) => state.region);
  const features = useStore((state) => state.features);
  const hexes = useStore((state) => state.hexes);
  const cycle = useStore((state) => state.cycle);
  const auth = useStore((state) => state.auth);
  const userVotes = useStore((state) => state.userVotes);

  // Get stable action references (actions never change)
  const setRegion = useStore.getState().setRegion;
  const setFeatures = useStore.getState().setFeatures;
  const setHexes = useStore.getState().setHexes;
  const setCycle = useStore.getState().setCycle;
  const setAuth = useStore.getState().setAuth;
  const setUserVote = useStore.getState().setUserVote;
  const clearUserVote = useStore.getState().clearUserVote;
  
  const [resourceDeltas, setResourceDeltas] = useState<ResourceDelta[]>([]);
  const prevTasksRef = useRef<Map<string, string>>(new Map());
  const hasHydratedRef = useRef(false);

  // Batch event data to avoid rapid re-renders
  const pendingUpdatesRef = useRef<{
    cycle: Partial<CycleState> | null;
    hexUpdates: Map<string, { h3_index: string; rust_level: number }>;
    regionUpdate: { pool_food: number; pool_equipment: number; pool_energy: number; pool_materials: number; rust_avg?: number | null; health_avg?: number | null } | null;
    featureUpdates: Map<string, { health: number; status: string }>;
    taskUpdates: Map<string, { task_id: string; status: string; priority_score: number; vote_score?: number; cost_food?: number; cost_equipment?: number; cost_energy?: number; cost_materials?: number; duration_s?: number; repair_amount?: number; task_type?: string; target_gers_id?: string; region_id?: string }>;
    resourceDeltas: ResourceDelta[];
    needsTaskRefetch: boolean;
    dirty: boolean;
  }>({
    cycle: null,
    hexUpdates: new Map(),
    regionUpdate: null,
    featureUpdates: new Map(),
    taskUpdates: new Map(),
    resourceDeltas: [],
    needsTaskRefetch: false,
    dirty: false
  });

  // Hydrate store exactly once (survives strict mode double-render)
  useLayoutEffect(() => {
    if (hasHydratedRef.current) return;
    hasHydratedRef.current = true;
    useStore.setState({
      region: initialRegion,
      features: initialFeatures,
      hexes: initialHexes,
      cycle: initialCycle,
      availableRegions,
      isDemoMode
    });
    // Clear history and record initial values for the new region
    clearResourceHistory();
    recordResourceValues({
      pool_food: initialRegion.pool_food,
      pool_equipment: initialRegion.pool_equipment,
      pool_energy: initialRegion.pool_energy,
      pool_materials: initialRegion.pool_materials
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Spawn initial resource transfers that are already in-transit
  useEffect(() => {
    if (!initialRegion.resource_transfers) return;

    const now = Date.now();
    for (const transfer of initialRegion.resource_transfers) {
      const arriveAt = Date.parse(transfer.arrive_at);
      // Only spawn transfers that haven't arrived yet
      if (!Number.isNaN(arriveAt) && arriveAt > now) {
        const payload: ResourceTransferPayload = {
          transfer_id: transfer.transfer_id,
          region_id: initialRegion.region_id,
          source_gers_id: transfer.source_gers_id,
          hub_gers_id: transfer.hub_gers_id,
          resource_type: transfer.resource_type as ResourceType,
          amount: transfer.amount,
          depart_at: transfer.depart_at,
          arrive_at: transfer.arrive_at,
          path_waypoints: transfer.path_waypoints
        };
        window.dispatchEvent(new CustomEvent("nightfall:resource_transfer", { detail: payload }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    initializeSession(apiBaseUrl).then((authData) => {
      setAuth(authData);
    });
  }, [apiBaseUrl, setAuth]);

  // Periodically apply batched updates to avoid rapid re-renders from SSE events
  useEffect(() => {
    const interval = setInterval(() => {
      const pending = pendingUpdatesRef.current;

      // Skip if no pending updates
      if (!pending.dirty) return;

      // Apply all batched updates
      if (pending.cycle) {
        setCycle((prev) => ({
          ...prev,
          ...pending.cycle,
          phase_progress: pending.cycle?.phase_progress ?? prev.phase_progress,
          lastUpdated: Date.now()
        }));
        pending.cycle = null;
      }

      if (pending.hexUpdates.size > 0) {
        setHexes((prev) => {
          const map = new Map(prev.map((h) => [h.h3_index, h]));
          for (const [, update] of pending.hexUpdates) {
            map.set(update.h3_index, update);
          }
          return Array.from(map.values());
        });
        pending.hexUpdates.clear();
      }

      if (pending.regionUpdate) {
        const update = pending.regionUpdate;
        setRegion((prev) => ({
          ...prev,
          pool_food: update.pool_food,
          pool_equipment: update.pool_equipment,
          pool_energy: update.pool_energy,
          pool_materials: update.pool_materials,
          stats: {
            ...prev.stats,
            rust_avg: update.rust_avg ?? prev.stats.rust_avg,
            health_avg: update.health_avg ?? prev.stats.health_avg
          }
        }));
        // Record resource values for trendline history
        recordResourceValues({
          pool_food: update.pool_food,
          pool_equipment: update.pool_equipment,
          pool_energy: update.pool_energy,
          pool_materials: update.pool_materials
        });
        pending.regionUpdate = null;
      }

      if (pending.featureUpdates.size > 0) {
        setFeatures((prev) =>
          prev.map((f) => {
            const update = pending.featureUpdates.get(f.gers_id);
            return update ? { ...f, health: update.health, status: update.status } : f;
          })
        );
        pending.featureUpdates.clear();
      }

      if (pending.taskUpdates.size > 0) {
        setRegion((prev) => {
          let tasks = [...prev.tasks];
          for (const [, delta] of pending.taskUpdates) {
            const existingIdx = tasks.findIndex(t => t.task_id === delta.task_id);
            if (existingIdx >= 0) {
              tasks[existingIdx] = { ...tasks[existingIdx], ...delta };
            } else if (delta.region_id && delta.target_gers_id) {
              tasks.push({
                task_id: delta.task_id,
                status: delta.status,
                priority_score: delta.priority_score,
                vote_score: delta.vote_score ?? 0,
                cost_food: delta.cost_food ?? 0,
                cost_equipment: delta.cost_equipment ?? 0,
                cost_energy: delta.cost_energy ?? 0,
                cost_materials: delta.cost_materials ?? 0,
                duration_s: delta.duration_s ?? 0,
                repair_amount: delta.repair_amount ?? 0,
                task_type: delta.task_type ?? "unknown",
                target_gers_id: delta.target_gers_id,
                region_id: delta.region_id
              });
            }
            // Clean up completed/expired tasks from prevTasksRef to prevent unbounded growth
            if (delta.status === 'done' || delta.status === 'expired') {
              prevTasksRef.current.delete(delta.task_id);
            }
          }
          tasks = tasks.filter(t => t.status !== 'done' && t.status !== 'expired');
          pending.taskUpdates.clear();
          return { ...prev, tasks };
        });
      }

      if (pending.resourceDeltas.length > 0) {
        setResourceDeltas((prev) => [...pending.resourceDeltas, ...prev].slice(0, 6));
        pending.resourceDeltas = [];
      }

      // Handle task refetch notification - tasks are refreshed on next full region load
      if (pending.needsTaskRefetch) {
        console.debug("[Dashboard] Tasks changed, will refresh on next region load");
        pending.needsTaskRefetch = false;
      }

      pending.dirty = false;
    }, 150); // Apply batched updates every 150ms
    return () => clearInterval(interval);
  }, [setCycle, setHexes, setRegion, setFeatures]);

  // Use ref to avoid stale closure issues in event handler
  const regionRef = useRef(region);
  useEffect(() => {
    regionRef.current = region;
  }, [region]);

  const handleEvent = useCallback((payload: EventPayload) => {
    const pending = pendingUpdatesRef.current;

    switch (payload.event) {
    case "phase_change":
      pending.cycle = payload.data as Partial<CycleState>;
      pending.dirty = true;
      break;
    case "world_delta": {
      const data = payload.data as {
        rust_changed?: string[];
        hex_updates?: { h3_index: string; rust_level: number }[];
        regions_changed?: string[];
        region_updates?: {
          region_id: string;
          pool_food: number;
          pool_equipment: number;
          pool_energy: number;
          pool_materials: number;
          rust_avg?: number | null;
          health_avg?: number | null;
        }[];
      };

      if (data.hex_updates?.length) {
        for (const update of data.hex_updates) {
          pending.hexUpdates.set(update.h3_index, update);
        }
        pending.dirty = true;
      }

      if (data.region_updates?.length) {
        console.debug("[SSE] world_delta region_updates:", data.region_updates.map(r => ({ region_id: r.region_id, health_avg: r.health_avg, rust_avg: r.rust_avg })));
        const match = data.region_updates.find((r) => r.region_id === regionRef.current.region_id);
        if (match) {
          // Calculate resource deltas
          const prevFood = pending.regionUpdate?.pool_food ?? regionRef.current.pool_food;
          const prevEquipment = pending.regionUpdate?.pool_equipment ?? regionRef.current.pool_equipment;
          const prevEnergy = pending.regionUpdate?.pool_energy ?? regionRef.current.pool_energy;
          const prevMaterials = pending.regionUpdate?.pool_materials ?? regionRef.current.pool_materials;
          const foodDelta = match.pool_food - prevFood;
          const equipmentDelta = match.pool_equipment - prevEquipment;
          const energyDelta = match.pool_energy - prevEnergy;
          const materialDelta = match.pool_materials - prevMaterials;
          if (foodDelta !== 0) {
            pending.resourceDeltas.push({ type: "food", delta: foodDelta, source: "Daily ops", ts: Date.now() });
          }
          if (equipmentDelta !== 0) {
            pending.resourceDeltas.push({ type: "equipment", delta: equipmentDelta, source: "Daily ops", ts: Date.now() });
          }
          if (energyDelta !== 0) {
            pending.resourceDeltas.push({ type: "energy", delta: energyDelta, source: "Daily ops", ts: Date.now() });
          }
          if (materialDelta !== 0) {
            pending.resourceDeltas.push({ type: "materials", delta: materialDelta, source: "Daily ops", ts: Date.now() });
          }
          pending.regionUpdate = match;
          pending.dirty = true;
        }
      }

      break;
    }
    case "resource_transfer": {
      const transfer = payload.data as ResourceTransferPayload;
      if (transfer.region_id !== regionRef.current.region_id) {
        break;
      }
      window.dispatchEvent(new CustomEvent("nightfall:resource_transfer", { detail: transfer }));
      break;
    }
    case "feature_delta": {
      type FeatureDelta = { gers_id: string; health: number; status: string };
      const data = payload.data as
        | FeatureDelta
        | { features: FeatureDelta[] };

      // Handle batched format
      if ('features' in data) {
        console.debug("[SSE] feature_delta batch received:", data.features.length, "updates");
        for (const delta of data.features) {
          pending.featureUpdates.set(delta.gers_id, delta);
        }
      } else {
        console.debug("[SSE] feature_delta received:", data.gers_id, "health:", data.health);
        pending.featureUpdates.set(data.gers_id, data);
      }
      pending.dirty = true;
      break;
    }
    case "task_delta": {
      type TaskDelta = {
        task_id: string;
        status: string;
        priority_score: number;
        vote_score?: number;
        cost_food?: number;
        cost_equipment?: number;
        cost_energy?: number;
        cost_materials?: number;
        duration_s?: number;
        repair_amount?: number;
        task_type?: string;
        target_gers_id?: string;
        region_id?: string;
      };

      const data = payload.data as TaskDelta | { tasks: TaskDelta[] } | { regions_changed: string[]; count: number };

      // New lightweight format: just regions_changed with count
      if ('regions_changed' in data) {
        // Mark that we need to refetch tasks for this region
        console.debug("[SSE] task_delta regions_changed:", data.regions_changed, "count:", data.count);
        pending.needsTaskRefetch = true;
        pending.dirty = true;
        break;
      }

      const processTaskDelta = (delta: TaskDelta) => {
        // Check if this task just completed
        const prevStatus = prevTasksRef.current.get(delta.task_id);
        if (delta.status === 'done' && prevStatus && prevStatus !== 'done') {
          // Task just completed - show toast and trigger animation
          toast.success("Repair Complete!", {
            description: `Road segment restored to full health`,
            duration: 4000
          });

          // Emit event for map animation
          if (delta.target_gers_id) {
            window.dispatchEvent(new CustomEvent("nightfall:task_completed", {
              detail: { gers_id: delta.target_gers_id }
            }));
          }
        }

        // Track status for next comparison
        prevTasksRef.current.set(delta.task_id, delta.status);
        pending.taskUpdates.set(delta.task_id, delta);
      };

      // Handle batched format (legacy)
      if ('tasks' in data) {
        for (const delta of data.tasks) {
          processTaskDelta(delta);
        }
      } else {
        processTaskDelta(data);
      }
      pending.dirty = true;
      break;
    }
    }
  }, []);

  useEventStream(apiBaseUrl, handleEvent);

  const handleVote = useCallback(async (taskId: string, weight: number): Promise<void> => {
    if (!auth.clientId || !auth.token) return;

    const currentVote = userVotes[taskId];
    const isTogglingOff = currentVote === weight;

    try {
      const res = await fetch(`${apiBaseUrl}/api/vote`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${auth.token}`
        },
        body: JSON.stringify({ client_id: auth.clientId, task_id: taskId, weight })
      });
      if (res.ok) {
        const data = await res.json();
        setRegion(prev => ({
          ...prev,
          tasks: prev.tasks.map(t =>
            t.task_id === taskId ? {
              ...t,
              vote_score: data.new_vote_score,
              priority_score: data.priority_score ?? t.priority_score
            } : t
          )
        }));

        // Track user's vote state
        if (isTogglingOff) {
          // Toggling off - clear the vote (they clicked same button again)
          clearUserVote(taskId);
        } else {
          setUserVote(taskId, weight);
        }

        // Show feedback toast
        const action = isTogglingOff
          ? "Vote removed"
          : weight > 0
            ? "Upvoted!"
            : "Downvoted";
        const description = isTogglingOff
          ? "Your vote has been withdrawn"
          : weight > 0
            ? "This task will be prioritized higher"
            : "This task will be prioritized lower";
        toast.success(action, { description });
      } else {
        throw new Error("Vote failed");
      }
    } catch (err) {
      console.error("Failed to vote", err);
      toast.error("Vote failed", { description: "Please try again" });
      throw err;
    }
  }, [apiBaseUrl, auth, userVotes, setRegion, setUserVote, clearUserVote]);

  const handleContribute = useCallback(async (
    sourceGersId: string,
    resourceType: "food" | "equipment" | "energy" | "materials",
    amount: number
  ) => {
    if (!auth.clientId || !auth.token) return;
    try {
      const res = await fetch(`${apiBaseUrl}/api/contribute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${auth.token}`
        },
        body: JSON.stringify({
          client_id: auth.clientId,
          region_id: region.region_id,
          food: resourceType === "food" ? amount : 0,
          equipment: resourceType === "equipment" ? amount : 0,
          energy: resourceType === "energy" ? amount : 0,
          materials: resourceType === "materials" ? amount : 0,
          source_gers_id: sourceGersId
        })
      });
      if (res.ok) {
        await res.json();
      }
    } catch (err) {
      console.error("Failed to contribute", err);
    }
  }, [apiBaseUrl, auth, region.region_id]);

  const counts = useMemo(() => {
    let roads = 0;
    let buildings = 0;
    let healthy = 0;
    let degraded = 0;
    let foodBuildings = 0;
    let equipmentBuildings = 0;
    let energyBuildings = 0;
    let materialBuildings = 0;

    for (const f of features) {
      if (f.feature_type === "road") {
        roads += 1;
        if (f.health !== undefined && f.health !== null) {
          if (f.health >= DEGRADED_HEALTH_THRESHOLD) healthy += 1;
          else degraded += 1;
        }
      } else if (f.feature_type === "building") {
        buildings += 1;
        if (f.generates_food) foodBuildings += 1;
        if (f.generates_equipment) equipmentBuildings += 1;
        if (f.generates_energy) energyBuildings += 1;
        if (f.generates_materials) materialBuildings += 1;
      }
    }

    return { roads, buildings, healthy, degraded, foodBuildings, equipmentBuildings, energyBuildings, materialBuildings };
  }, [features]);

  const healthPercent = region.stats.health_avg;
  const rustPercent = region.stats.rust_avg * 100;

  const SidebarContent = ({ resourceFeed }: { resourceFeed: ResourceDelta[] }) => (
    <>
      <div className="rounded-3xl border border-[var(--night-outline)] bg-white/60 p-5 shadow-[0_18px_40px_rgba(24,20,14,0.12)]">
        <p className="text-xs uppercase tracking-[0.4em] text-[color:var(--night-ash)]">
          Resource Pools
        </p>
        <div className="mt-4">
          <ResourcePoolsPanel
            poolFood={region.pool_food}
            poolEquipment={region.pool_equipment}
            poolEnergy={region.pool_energy}
            poolMaterials={region.pool_materials}
            foodBuildings={counts.foodBuildings}
            equipmentBuildings={counts.equipmentBuildings}
            energyBuildings={counts.energyBuildings}
            materialBuildings={counts.materialBuildings}
            variant="light"
          />
        </div>
      </div>

      <ResourceTicker deltas={resourceFeed} />

      <div className="rounded-3xl border border-[var(--night-outline)] bg-[color:var(--night-ink)]/80 p-5 text-white shadow-[0_18px_40px_rgba(24,20,14,0.2)]">
        <TaskList tasks={region.tasks} crews={region.crews} features={features} userVotes={userVotes} resourcePools={{ food: region.pool_food, equipment: region.pool_equipment, energy: region.pool_energy, materials: region.pool_materials }} onVote={handleVote} />
      </div>

      <div className="rounded-3xl border border-[var(--night-outline)] bg-white/60 p-5 shadow-[0_18px_40px_rgba(24,20,14,0.12)]">
        <p className="text-xs uppercase tracking-[0.4em] text-[color:var(--night-ash)]">
          Region Health
        </p>
        <div className="mt-4">
          <RegionHealthPanel
            healthAvg={region.stats.health_avg}
            rustAvg={region.stats.rust_avg}
            variant="light"
          />
        </div>
      </div>
    </>
  );

  const phaseGlow = {
    dawn: "shadow-[inset_0_0_100px_rgba(251,191,36,0.2)]",
    day: "",
    dusk: "shadow-[inset_0_0_100px_rgba(245,158,11,0.2)]",
    night: "shadow-[inset_0_0_150px_rgba(127,29,29,0.3)]"
  };

  // Memoize boundary to prevent map re-initialization
  const stableBoundary = useMemo(() => region.boundary, [region.boundary]);

  return (
    <div className={`relative min-h-screen transition-all duration-[2500ms] ease-in-out ${phaseGlow[cycle.phase]}`}>
      <DemoMap
        boundary={stableBoundary}
        features={features}
        hexes={hexes}
        crews={region.crews}
        tasks={region.tasks}
        fallbackBbox={BAR_HARBOR_DEMO_BBOX}
        focusH3Index={region.focus_h3_index}
        cycle={cycle}
        pmtilesRelease={pmtilesRelease}
        className="h-screen w-full rounded-none border-0 shadow-none"
      >
        <div className="pointer-events-none absolute inset-0">
          {cycle.phase === "dusk" && (
            <div className="pointer-events-none absolute top-20 left-1/2 z-40 -translate-x-1/2">
              <div className="animate-pulse rounded-full border border-amber-500/50 bg-amber-900/80 px-6 py-2 text-xs font-bold uppercase tracking-[0.2em] text-amber-200 shadow-[0_0_20px_rgba(245,158,11,0.4)] backdrop-blur-md">
                Warning: Nightfall Imminent ({formatTime(cycle.next_phase_in_seconds)})
              </div>
            </div>
          )}

          {cycle.phase === "dawn" && cycle.phase_progress < 0.2 && (
            <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
              <div className="animate-[fade-out_4s_ease-out_forwards] text-center">
                <h2 className="text-4xl font-bold uppercase tracking-[0.5em] text-amber-100 opacity-0 blur-xl animate-[reveal_4s_ease-out_forwards]">
                  The Sun Rises
                </h2>
              </div>
            </div>
          )}

          <div className="pointer-events-auto absolute left-4 right-4 top-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <MapPanel className="max-w-[520px]">
              <p className="text-[10px] uppercase tracking-[0.5em] text-white/60">
                Nightfall Ops Console
                {isDemoMode && (
                  <span className="ml-3 rounded bg-red-900/50 px-2 py-0.5 text-[0.65rem] font-bold text-red-200">
                    DEMO MODE
                  </span>
                )}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <h1 className="font-display text-3xl text-white sm:text-4xl">
                  {region.name}
                </h1>
                {availableRegions?.length > 1 && (
                  <select
                    className="rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs text-white/80 backdrop-blur-sm transition-colors hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-[var(--night-teal)]"
                    value={region.region_id}
                    onChange={(e) => router.push(`/?region=${e.target.value}`)}
                  >
                    {availableRegions.map((r) => (
                      <option key={r.region_id} value={r.region_id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <h2 className="mt-2 text-xs font-medium uppercase tracking-[0.2em] text-[color:var(--night-moss)]">
                The city endures. The nights get longer.
              </h2>
            </MapPanel>

            <PhaseIndicator />
          </div>

          <MapOverlay position="top-right" className="!top-24 hidden w-72 flex-col gap-4 lg:flex">
            <MapPanel title="Resource Pools">
              <ResourcePoolsPanel
                poolFood={region.pool_food}
                poolEquipment={region.pool_equipment}
                poolEnergy={region.pool_energy}
                poolMaterials={region.pool_materials}
                foodBuildings={counts.foodBuildings}
                equipmentBuildings={counts.equipmentBuildings}
                energyBuildings={counts.energyBuildings}
                materialBuildings={counts.materialBuildings}
                variant="dark"
              />
            </MapPanel>

            <MapPanel title="Region Health" className="flex flex-col items-center">
              <RegionalHealthRing
                className="map-overlay-ring"
                healthPercent={healthPercent}
                rustLevel={rustPercent}
              />
              <div className="mt-3 grid w-full grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl bg-white/5 px-2 py-2 text-center">
                  <p className="text-[9px] uppercase tracking-[0.2em] text-white/40">Roads Healthy</p>
                  <p className="mt-1 text-sm font-semibold text-[color:var(--night-teal)]">
                    {formatNumber(counts.healthy)}
                  </p>
                </div>
                <div className="rounded-xl bg-white/5 px-2 py-2 text-center">
                  <p className="text-[9px] uppercase tracking-[0.2em] text-white/40">Degraded</p>
                  <p className="mt-1 text-sm font-semibold text-red-400">
                    {formatNumber(counts.degraded)}
                  </p>
                </div>
              </div>
            </MapPanel>

            <ResourceTicker deltas={resourceDeltas} />
          </MapOverlay>

          <MapOverlay position="bottom-left" className="!bottom-20 hidden w-[360px] max-h-[55vh] lg:flex flex-col">
            <MapPanel title="Operations Queue" className="h-full min-h-0">
              <TaskList tasks={region.tasks} crews={region.crews} features={features} userVotes={userVotes} resourcePools={{ food: region.pool_food, equipment: region.pool_equipment, energy: region.pool_energy, materials: region.pool_materials }} onVote={handleVote} />
            </MapPanel>
          </MapOverlay>

          <MapOverlay position="bottom-left" className="!bottom-12 z-40">
            <details className="group relative">
              <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full border border-white/10 bg-black/40 text-xs font-semibold uppercase tracking-widest text-white/70 shadow-[0_8px_20px_rgba(0,0,0,0.4)] backdrop-blur-sm transition hover:border-white/30 hover:text-white [&::-webkit-details-marker]:hidden">
                i
              </summary>
              <div className="absolute bottom-full left-0 mb-3 w-72 rounded-2xl border border-white/10 bg-[#0f1216]/90 p-4 text-[11px] text-white/70 shadow-[0_14px_28px_rgba(0,0,0,0.5)] backdrop-blur-md">
                <p className="text-[10px] uppercase tracking-[0.3em] text-white/40">Attribution</p>
                <p className="mt-2 leading-relaxed">
                  Data from Overture Maps Foundation (CDLA Permissive v2.0), OpenStreetMap contributors,
                  and the H3 geospatial indexing system (Apache 2.0).
                </p>
                <p className="mt-2 text-white/40">Required software + data provider notice.</p>
              </div>
            </details>
          </MapOverlay>


          <div className="pointer-events-auto absolute bottom-0 left-0 right-0 lg:hidden">
            <MobileSidebar>
              <SidebarContent resourceFeed={resourceDeltas} />
            </MobileSidebar>
          </div>

          <div className="pointer-events-auto">
            <FeaturePanel
              activeTasks={region.tasks}
              onVote={handleVote}
              onContribute={handleContribute}
              canContribute={Boolean(auth.token && auth.clientId)}
              userVotes={userVotes}
            />
          </div>
        </div>
      </DemoMap>
      <OnboardingOverlay />
    </div>
  );
}
