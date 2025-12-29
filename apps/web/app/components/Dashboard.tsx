"use client";

import { useState, useMemo, useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import DemoMap from "./DemoMap";
import PhaseIndicator from "./PhaseIndicator";
import FeaturePanel from "./FeaturePanel";
import MobileSidebar from "./MobileSidebar";
import { MapOverlay } from "./MapOverlay";
import { useEventStream, SSE_STALE_THRESHOLD_MS, type EventPayload } from "../hooks/useEventStream";
import { useStore, type Region, type Feature, type Hex, type CycleState } from "../store";
import { BAR_HARBOR_DEMO_BBOX, DEGRADED_HEALTH_THRESHOLD, calculateCityScore, SCORE_ACTIONS } from "@nightfall/config";
import { fetchWithRetry } from "../lib/retry";
import { ResourcePoolsPanel } from "./sidebar/ResourcePoolsPanel";
import { RegionHealthPanel } from "./sidebar/RegionHealthPanel";
import { OnboardingOverlay } from "./OnboardingOverlay";
import { ConnectionStatus } from "./ConnectionStatus";
import { recordResourceValues, clearResourceHistory } from "../lib/resourceHistory";
import { recordHealthValues, clearHealthHistory } from "../lib/healthHistory";
import { MinigameOverlay } from "./minigames";
import { RepairMinigameOverlay } from "./minigames/repair";
import { Navigation } from "lucide-react";
import { AdminConsole } from "./admin";
import { PlayerTierBadgeCompact } from "./PlayerTierBadge";
import { PerformanceOverlay, trackBatchFire } from "./PerformanceOverlay";

type ResourceType = "food" | "equipment" | "energy" | "materials";

type ResourceDelta = {
  type: ResourceType;
  delta: number;
  source: string;
  ts: number;
  transferId?: string; // For in-transit items, to enable fly-to-convoy
  arriveAt?: number; // For in-transit items, to show ETA
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
  boost_multiplier?: number | null;
};

type DashboardProps = {
  initialRegion: Region;
  initialFeatures: Feature[];
  initialHexes: Hex[];
  initialCycle: CycleState;
  availableRegions: { region_id: string; name: string }[];
  isDemoMode: boolean;
  apiBaseUrl: string;
  pmtilesRelease: string | null;
};

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const FETCH_RETRY_OPTIONS = { attempts: 3, baseDelayMs: 250, maxDelayMs: 2000, jitter: 0.2 };
const BATCH_DEBOUNCE_MS = 100; // Debounce rapid ID notifications

const RESOURCE_LABELS: Record<ResourceType, string> = {
  food: "Food",
  equipment: "Equipment",
  energy: "Energy",
  materials: "Materials"
};

// Resource colors matching ResourcePoolsPanel
const RESOURCE_COLORS: Record<ResourceType, string> = {
  food: "#4ade80",      // green-400
  equipment: "#f97316", // orange-500
  energy: "#facc15",    // yellow-400
  materials: "#818cf8"  // indigo-400
};

// Tailwind lg breakpoint is 1024px, so max-width for mobile is 1023px
const MOBILE_MAX_WIDTH = "(max-width: 1023px)";
const HEADER_AUTO_COLLAPSE_DELAY_MS = 3000;

type ActiveTask = {
  task_id: string;
  target_gers_id: string;
  task_type: string;
  status: string;
  busy_until: string | null;
};

type TravelingCrew = {
  crew_id: string;
  target_gers_id: string | null;
  busy_until: string | null;
};

function ActiveEvents({ deltas, activeTasks, travelingCrews, features }: { deltas: ResourceDelta[]; activeTasks: ActiveTask[]; travelingCrews: TravelingCrew[]; features: Feature[] }) {
  const handleFlyToConvoy = (transferId: string) => {
    window.dispatchEvent(new CustomEvent("nightfall:fly_to_convoy", {
      detail: { transfer_id: transferId }
    }));
  };

  const handleFlyToTask = (gersId: string) => {
    window.dispatchEvent(new CustomEvent("nightfall:fly_to_feature", {
      detail: { gers_id: gersId }
    }));
  };

  const handleFlyToCrew = (crewId: string) => {
    window.dispatchEvent(new CustomEvent("nightfall:fly_to_crew", {
      detail: { crew_id: crewId }
    }));
  };

  const getFeatureName = (gersId: string) => {
    const feature = features.find(f => f.gers_id === gersId);
    // Use road_class if available, otherwise fallback to "Road segment"
    return feature?.road_class ? `${feature.road_class.charAt(0).toUpperCase()}${feature.road_class.slice(1)} road` : "Road segment";
  };

  const formatTaskType = (taskType: string) => {
    return taskType.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  };

  const hasActivity = deltas.length > 0 || activeTasks.length > 0 || travelingCrews.length > 0;

  const formatTimeRemaining = (busyUntil: string | null) => {
    if (!busyUntil) return null;
    const remaining = (new Date(busyUntil).getTime() - Date.now()) / 1000;
    if (remaining <= 0) return null;
    if (remaining < 60) return `${Math.round(remaining)}s`;
    return `${Math.floor(remaining / 60)}m ${Math.round(remaining % 60)}s`;
  };

  const formatEtaFromTimestamp = (arriveAt: number | undefined) => {
    if (!arriveAt) return null;
    const remaining = (arriveAt - Date.now()) / 1000;
    if (remaining <= 0) return null;
    if (remaining < 60) return `${Math.round(remaining)}s`;
    return `${Math.floor(remaining / 60)}m ${Math.round(remaining % 60)}s`;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-2xl border border-white/20 bg-[rgba(12,16,20,0.45)] px-4 py-3 shadow-[0_12px_30px_rgba(0,0,0,0.35)] backdrop-blur-md">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-white/60 flex-shrink-0">
        <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-[color:var(--night-teal)] shadow-[0_0_8px_var(--night-teal)]" />
        Active Events
      </div>
      <div className="space-y-1 overflow-y-auto flex-1 min-h-0">
        {!hasActivity ? (
          <div className="text-[11px] text-white/40">Awaiting activity...</div>
        ) : (
          <>
            {/* Traveling crews */}
            {travelingCrews.map((crew) => {
              const timeStr = formatTimeRemaining(crew.busy_until);
              return (
                <div
                  key={crew.crew_id}
                  className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-[11px] text-white/80 animate-[fade-in_400ms_ease]"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-6 w-6 rounded-lg text-xs font-bold text-white flex items-center justify-center flex-shrink-0"
                      style={{
                        background: "linear-gradient(135deg, #f0ddc299, #f0ddc266)",
                        boxShadow: "0 0 12px #f0ddc240"
                      }}
                    >
                      🚚
                    </span>
                    <div className="leading-tight min-w-0">
                      <div className="font-semibold">Crew En Route</div>
                      <div className="text-[10px] uppercase tracking-[0.2em] text-white/40 truncate">
                        {crew.target_gers_id ? getFeatureName(crew.target_gers_id) : "Returning to hub"}
                        {timeStr && <span className="ml-2 text-[color:var(--night-teal)]">ETA {timeStr}</span>}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleFlyToCrew(crew.crew_id)}
                    className="rounded-full p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white flex-shrink-0"
                    title="Fly to crew"
                    aria-label="Fly to crew on map"
                  >
                    <Navigation className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
            {/* Active repair tasks */}
            {activeTasks.map((task) => {
              const taskEta = formatTimeRemaining(task.busy_until);
              return (
                <div
                  key={task.task_id}
                  className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-[11px] text-white/80 animate-[fade-in_400ms_ease]"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-6 w-6 rounded-lg text-xs font-bold text-white flex items-center justify-center flex-shrink-0"
                      style={{
                        background: "linear-gradient(135deg, #f59e0b99, #f59e0b66)",
                        boxShadow: "0 0 12px #f59e0b40"
                      }}
                    >
                      ⚙
                    </span>
                    <div className="leading-tight min-w-0">
                      <div className="font-semibold">{formatTaskType(task.task_type)}</div>
                      <div className="text-[10px] uppercase tracking-[0.2em] text-white/40 truncate">
                        {getFeatureName(task.target_gers_id)}
                        {taskEta && <span className="ml-2 text-[color:var(--night-teal)]">ETA {taskEta}</span>}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleFlyToTask(task.target_gers_id)}
                    className="rounded-full p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white flex-shrink-0"
                    title="Fly to repair site"
                    aria-label="Fly to repair site on map"
                  >
                    <Navigation className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
            {/* Resource transfers */}
            {deltas.map((item, idx) => {
              const color = RESOURCE_COLORS[item.type];
              const transitEta = item.source === "In transit" ? formatEtaFromTimestamp(item.arriveAt) : null;
              return (
                <div
                  key={item.ts + idx}
                  className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-[11px] text-white/80 animate-[fade-in_400ms_ease]"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-6 w-6 rounded-lg text-xs font-bold text-white flex items-center justify-center flex-shrink-0"
                      style={{
                        background: `linear-gradient(135deg, ${color}99, ${color}66)`,
                        boxShadow: `0 0 12px ${color}40`
                      }}
                    >
                      {item.source === "In transit" ? "→" : item.delta > 0 ? "+" : "−"}
                    </span>
                    <div className="leading-tight min-w-0">
                      <div className="font-semibold">
                        {RESOURCE_LABELS[item.type]} {item.source === "In transit" ? "in transit" : item.delta > 0 ? "added" : "spent"} {Math.abs(Math.round(item.delta))}
                      </div>
                      <div className="text-[10px] uppercase tracking-[0.2em] text-white/40">
                        {item.source}
                        {transitEta && <span className="ml-2 text-[color:var(--night-teal)]">ETA {transitEta}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {item.source === "In transit" && item.transferId && (
                      <button
                        type="button"
                        onClick={() => handleFlyToConvoy(item.transferId!)}
                        className="rounded-full p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
                        title="Fly to convoy"
                        aria-label="Fly to convoy on map"
                      >
                        <Navigation className="h-3 w-3" />
                      </button>
                    )}
                    {item.source !== "In transit" && (
                      <span className="text-[10px] text-white/40">
                        {new Date(item.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function RadialStat({
  value,
  max,
  label,
  color,
  emoji,
  format = "percent"
}: {
  value: number;
  max: number;
  label: string;
  color: string;
  emoji?: string;
  format?: "percent" | "fraction" | "number";
}) {
  const percent = max > 0 ? (value / max) * 100 : 0;
  const circumference = 2 * Math.PI * 18; // radius = 18
  const strokeDashoffset = circumference - (percent / 100) * circumference;

  const displayValue = format === "percent"
    ? `${Math.round(percent)}%`
    : format === "fraction"
      ? `${value}/${max}`
      : `${value}`;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative h-12 w-12">
        <svg className="h-full w-full -rotate-90" viewBox="0 0 40 40">
          <circle
            cx="20"
            cy="20"
            r="18"
            fill="none"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="3"
          />
          <circle
            cx="20"
            cy="20"
            r="18"
            fill="none"
            stroke={color}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-all duration-500"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
          {displayValue}
        </div>
      </div>
      <span className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-white/50">
        {emoji && <span className="text-sm">{emoji}</span>}
        {label}
      </span>
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
      className={`flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0f1216]/60 p-4 text-white shadow-[0_12px_30px_rgba(0,0,0,0.45)] backdrop-blur-md${className ? ` ${className}` : ""}`}
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
  const activeMinigame = useStore((state) => state.activeMinigame);
  const minigameResult = useStore((state) => state.minigameResult);
  const activeRepairMinigame = useStore((state) => state.activeRepairMinigame);
  const repairMinigameResult = useStore((state) => state.repairMinigameResult);
  const buildingActivations = useStore((state) => state.buildingActivations);

  // Get stable action references (actions never change)
  const setRegion = useStore.getState().setRegion;
  const setFeatures = useStore.getState().setFeatures;
  const setHexes = useStore.getState().setHexes;
  const setCycle = useStore.getState().setCycle;
  const setAuth = useStore.getState().setAuth;
  const setUserVote = useStore.getState().setUserVote;
  const clearUserVote = useStore.getState().clearUserVote;
  const startMinigame = useStore.getState().startMinigame;
  const startRepairMinigame = useStore.getState().startRepairMinigame;
  const setCooldown = useStore.getState().setCooldown;
  const addVoteScore = useStore.getState().addVoteScore;

  const [resourceDeltas, setResourceDeltas] = useState<ResourceDelta[]>([]);
  const [showMinigameOverlay, setShowMinigameOverlay] = useState(false);
  const [showRepairMinigameOverlay, setShowRepairMinigameOverlay] = useState(false);
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false);
  const prevTasksRef = useRef<Map<string, string>>(new Map());
  const hasHydratedRef = useRef(false);

  // Batch event data to avoid rapid re-renders
  const pendingUpdatesRef = useRef<{
    cycle: Partial<CycleState> | null;
    hexUpdates: Map<string, { h3_index: string; rust_level: number }>;
    rustBulkUpdate: number | null;
    regionUpdate: { pool_food: number; pool_equipment: number; pool_energy: number; pool_materials: number; rust_avg?: number | null; health_avg?: number | null; score?: number | null } | null;
    featureUpdates: Map<string, { health: number; status: string }>;
    taskUpdates: Map<string, { task_id: string; status: string; priority_score: number; vote_score?: number; cost_food?: number; cost_equipment?: number; cost_energy?: number; cost_materials?: number; duration_s?: number; repair_amount?: number; task_type?: string; target_gers_id?: string; region_id?: string }>;
    crewUpdates: Map<string, { crew_id: string; event_type: string; waypoints?: { coord: [number, number]; arrive_at: string }[] | null; position?: { lng: number; lat: number } | null; task_id?: string | null }>;
    resourceDeltas: ResourceDelta[];
    needsTaskRefetch: boolean;
    dirty: boolean;
  }>({
    cycle: null,
    hexUpdates: new Map(),
    rustBulkUpdate: null,
    regionUpdate: null,
    featureUpdates: new Map(),
    taskUpdates: new Map(),
    crewUpdates: new Map(),
    resourceDeltas: [],
    needsTaskRefetch: false,
    dirty: false
  });

  // Pending batch fetch IDs (for debouncing rapid SSE notifications)
  const pendingBatchIdsRef = useRef<{
    hexIds: Set<string>;
    featureIds: Set<string>;
    transferIds: Set<string>;
    crewIds: Set<string>;
  }>({
    hexIds: new Set(),
    featureIds: new Set(),
    transferIds: new Set(),
    crewIds: new Set()
  });
  const batchFetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
    clearHealthHistory();
    recordResourceValues({
      pool_food: initialRegion.pool_food,
      pool_equipment: initialRegion.pool_equipment,
      pool_energy: initialRegion.pool_energy,
      pool_materials: initialRegion.pool_materials
    });
    // Record initial health values
    const initialScore = calculateCityScore(initialRegion.stats.health_avg, initialRegion.stats.rust_avg);
    recordHealthValues(initialRegion.stats.health_avg, initialRegion.stats.rust_avg, initialScore);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-collapse header on mobile after initial delay (stays expanded after manual interaction)
  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_MAX_WIDTH);
    if (!mediaQuery.matches) return;

    const timer = setTimeout(() => {
      setIsHeaderCollapsed(true);
    }, HEADER_AUTO_COLLAPSE_DELAY_MS);

    return () => clearTimeout(timer);
  }, []);

  // Track spawned transfer IDs to prevent duplicate convoy animations
  const spawnedTransferIdsRef = useRef<Set<string>>(new Set());

  // Spawn initial resource transfers that are already in-transit
  useEffect(() => {
    if (!initialRegion.resource_transfers) return;

    const now = Date.now();
    for (const transfer of initialRegion.resource_transfers) {
      const arriveAt = Date.parse(transfer.arrive_at);
      // Only spawn transfers that haven't arrived yet
      if (!Number.isNaN(arriveAt) && arriveAt > now) {
        // Track to prevent duplicates from SSE or polling
        spawnedTransferIdsRef.current.add(transfer.transfer_id);
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

      // Track batch fires for performance monitoring
      trackBatchFire(pending.dirty);

      // Periodically clean up stale "In transit" items (runs every tick)
      setResourceDeltas((prev) => {
        const now = Date.now();
        const cleaned = prev.filter(d => {
          if (d.source !== "In transit") return true;
          // Remove if ETA has passed (with 2s buffer)
          if (d.arriveAt && d.arriveAt < now - 2000) return false;
          return true;
        });
        return cleaned.length !== prev.length ? cleaned : prev;
      });

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

      // Handle bulk rust update (admin console set-rust)
      if (pending.rustBulkUpdate !== null) {
        const newRust = pending.rustBulkUpdate;
        console.debug("[Dashboard] Applying rustBulkUpdate:", newRust);
        setHexes((prev) => {
          console.debug("[Dashboard] Updating", prev.length, "hexes to rust level:", newRust);
          return prev.map((h) => ({ ...h, rust_level: newRust }));
        });
        pending.rustBulkUpdate = null;
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
            health_avg: update.health_avg ?? prev.stats.health_avg,
            score: update.score ?? prev.stats.score
          }
        }));
        // Record resource values for trendline history
        recordResourceValues({
          pool_food: update.pool_food,
          pool_equipment: update.pool_equipment,
          pool_energy: update.pool_energy,
          pool_materials: update.pool_materials
        });
        // Record health values for trend tracking
        if (update.health_avg != null && update.rust_avg != null) {
          const updatedScore = calculateCityScore(update.health_avg, update.rust_avg);
          recordHealthValues(update.health_avg, update.rust_avg, updatedScore);
        }
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

      // Apply crew updates (dispatched, arrived, returning, idle)
      if (pending.crewUpdates.size > 0) {
        setRegion((prev) => {
          const crews = prev.crews.map(crew => {
            const delta = pending.crewUpdates.get(crew.crew_id);
            if (!delta) return crew;

            // Map event_type to crew status
            const statusMap: Record<string, string> = {
              crew_dispatched: "traveling",
              crew_arrived: "working",
              crew_returning: "traveling",
              crew_idle: "idle"
            };
            const newStatus = statusMap[delta.event_type] ?? crew.status;

            return {
              ...crew,
              status: newStatus,
              active_task_id: delta.task_id ?? (delta.event_type === "crew_idle" ? null : crew.active_task_id),
              waypoints: delta.waypoints ?? null,
              path_started_at: delta.waypoints ? new Date().toISOString() : null,
              current_lng: delta.position?.lng ?? crew.current_lng,
              current_lat: delta.position?.lat ?? crew.current_lat
            };
          });
          pending.crewUpdates.clear();
          return { ...prev, crews };
        });
      }

      if (pending.resourceDeltas.length > 0) {
        // Get types that have arrived (positive delta with "Transfer arrived" source)
        const arrivedTypes = new Set(
          pending.resourceDeltas
            .filter(d => d.source === "Transfer arrived")
            .map(d => d.type)
        );
        const now = Date.now();
        setResourceDeltas((prev) => {
          // Filter out "In transit" items for types that have arrived OR whose ETA has passed
          const filtered = prev.filter(d => {
            if (d.source !== "In transit") return true;
            if (arrivedTypes.has(d.type)) return false;
            // Remove if ETA has passed (with 2s buffer for animation)
            if (d.arriveAt && d.arriveAt < now - 2000) return false;
            return true;
          });
          return [...pending.resourceDeltas, ...filtered].slice(0, 6);
        });
        pending.resourceDeltas = [];
      }

      // Handle task refetch notification - tasks are refreshed on next full region load
      if (pending.needsTaskRefetch) {
        console.debug("[Dashboard] Tasks changed, will refresh on next region load");
        pending.needsTaskRefetch = false;
      }

      pending.dirty = false;
    }, 250); // Apply batched updates every 250ms (reduced from 150ms for lower CPU usage)
    return () => clearInterval(interval);
  }, [setCycle, setHexes, setRegion, setFeatures]);

  // Use ref to avoid stale closure issues in event handler
  const regionRef = useRef(region);
  useEffect(() => {
    regionRef.current = region;
  }, [region]);

  // Track last SSE event time to detect stale connections
  const lastSseEventRef = useRef<number>(Date.now());
  const isRefreshingRef = useRef<boolean>(false);
  const POLL_INTERVAL_MS = 15000; // Check every 15 seconds

  // Refresh region state - used as fallback when SSE is stale
  const refreshRegionState = useCallback(async () => {
    // Prevent concurrent refreshes
    if (isRefreshingRef.current) {
      console.debug("[Dashboard] Refresh already in progress, skipping");
      return;
    }
    isRefreshingRef.current = true;

    try {
      const res = await fetchWithRetry(
        `${apiBaseUrl}/api/region/${regionRef.current.region_id}`,
        { cache: "no-store" },
        FETCH_RETRY_OPTIONS
      );
      if (!res.ok) {
        console.error("[Dashboard] Failed to refresh region state:", res.status);
        return;
      }
      const data = await res.json();

      // Update store with fresh data
      setRegion((prev) => ({
        ...prev,
        pool_food: data.pool_food,
        pool_equipment: data.pool_equipment,
        pool_energy: data.pool_energy,
        pool_materials: data.pool_materials,
        stats: data.stats ?? prev.stats,
        tasks: data.tasks ?? prev.tasks,
        crews: data.crews ?? prev.crews,
        resource_transfers: data.resource_transfers ?? []
      }));

      if (data.features) {
        setFeatures(data.features);
      }
      if (data.hexes) {
        setHexes(data.hexes);
      }

      // Spawn any in-transit resource transfers that we might have missed
      // Track spawned IDs to prevent duplicates across multiple refreshes
      if (data.resource_transfers) {
        const now = Date.now();
        const pending = pendingUpdatesRef.current;
        for (const transfer of data.resource_transfers) {
          const arriveAt = Date.parse(transfer.arrive_at);
          // Only spawn if not already spawned and hasn't arrived yet
          if (!spawnedTransferIdsRef.current.has(transfer.transfer_id) &&
              !Number.isNaN(arriveAt) && arriveAt > now) {
            spawnedTransferIdsRef.current.add(transfer.transfer_id);
            window.dispatchEvent(new CustomEvent("nightfall:resource_transfer", {
              detail: {
                transfer_id: transfer.transfer_id,
                region_id: data.region_id,
                source_gers_id: transfer.source_gers_id,
                hub_gers_id: transfer.hub_gers_id,
                resource_type: transfer.resource_type,
                amount: transfer.amount,
                depart_at: transfer.depart_at,
                arrive_at: transfer.arrive_at,
                path_waypoints: transfer.path_waypoints
              }
            }));
            // Also add to resource deltas for the ticker panel
            pending.resourceDeltas.push({
              type: transfer.resource_type,
              delta: -transfer.amount,
              source: "In transit",
              ts: Date.now(),
              transferId: transfer.transfer_id,
              arriveAt
            });
            pending.dirty = true;
          }
        }
        // Clean up old transfer IDs that are no longer in-transit
        const activeIds = new Set(data.resource_transfers.map((t: { transfer_id: string }) => t.transfer_id));
        for (const id of spawnedTransferIdsRef.current) {
          if (!activeIds.has(id)) {
            spawnedTransferIdsRef.current.delete(id);
          }
        }
      }

      console.debug("[Dashboard] Region state refreshed via polling fallback");
    } catch (err) {
      console.error("[Dashboard] Error refreshing region state:", err);
    } finally {
      isRefreshingRef.current = false;
    }
  }, [apiBaseUrl, setRegion, setFeatures, setHexes]);

  // Fetch batch data for pending IDs (called after debounce)
  const fetchBatchData = useCallback(async () => {
    const pendingBatch = pendingBatchIdsRef.current;
    const pending = pendingUpdatesRef.current;

    // Collect IDs to fetch
    const hexIds = Array.from(pendingBatch.hexIds);
    const featureIds = Array.from(pendingBatch.featureIds);
    const transferIds = Array.from(pendingBatch.transferIds);
    const crewIds = Array.from(pendingBatch.crewIds);

    // Clear pending sets
    pendingBatch.hexIds.clear();
    pendingBatch.featureIds.clear();
    pendingBatch.transferIds.clear();
    pendingBatch.crewIds.clear();

    // Fetch all in parallel
    const promises: Promise<void>[] = [];

    if (hexIds.length > 0) {
      promises.push(
        fetch(`${apiBaseUrl}/api/batch/hexes?ids=${hexIds.join(",")}`)
          .then(res => res.json())
          .then(data => {
            if (data.hexes) {
              for (const hex of data.hexes) {
                pending.hexUpdates.set(hex.h3_index, hex);
              }
              pending.dirty = true;
            }
          })
          .catch(err => console.error("[Dashboard] Failed to fetch batch hexes:", err))
      );
    }

    if (featureIds.length > 0) {
      promises.push(
        fetch(`${apiBaseUrl}/api/batch/features?ids=${featureIds.join(",")}`)
          .then(res => res.json())
          .then(data => {
            if (data.features) {
              for (const feature of data.features) {
                if (feature.health != null && feature.status != null) {
                  pending.featureUpdates.set(feature.gers_id, {
                    health: feature.health,
                    status: feature.status
                  });
                }
              }
              pending.dirty = true;
            }
          })
          .catch(err => console.error("[Dashboard] Failed to fetch batch features:", err))
      );
    }

    if (transferIds.length > 0) {
      promises.push(
        fetch(`${apiBaseUrl}/api/batch/transfers?ids=${transferIds.join(",")}`)
          .then(res => res.json())
          .then(data => {
            if (data.transfers) {
              for (const transfer of data.transfers) {
                if (transfer.region_id !== regionRef.current.region_id) continue;
                // Track spawned transfer to prevent duplicates
                if (!spawnedTransferIdsRef.current.has(transfer.transfer_id)) {
                  spawnedTransferIdsRef.current.add(transfer.transfer_id);
                  // Dispatch for map animation
                  window.dispatchEvent(new CustomEvent("nightfall:resource_transfer", { detail: transfer }));
                  // Add to resource deltas
                  pending.resourceDeltas.push({
                    type: transfer.resource_type,
                    delta: -transfer.amount,
                    source: "In transit",
                    ts: Date.now(),
                    transferId: transfer.transfer_id,
                    arriveAt: Date.parse(transfer.arrive_at)
                  });
                  pending.dirty = true;
                }
              }
            }
          })
          .catch(err => console.error("[Dashboard] Failed to fetch batch transfers:", err))
      );
    }

    if (crewIds.length > 0) {
      promises.push(
        fetch(`${apiBaseUrl}/api/batch/crews?ids=${crewIds.join(",")}`)
          .then(res => res.json())
          .then(data => {
            if (data.crews) {
              for (const crew of data.crews) {
                if (crew.region_id !== regionRef.current.region_id) continue;
                // Map status to event_type for existing handler
                const eventTypeMap: Record<string, string> = {
                  traveling: "crew_dispatched",
                  working: "crew_arrived",
                  idle: "crew_idle"
                };
                pending.crewUpdates.set(crew.crew_id, {
                  crew_id: crew.crew_id,
                  event_type: eventTypeMap[crew.status] ?? "crew_idle",
                  waypoints: crew.waypoints,
                  position: crew.position,
                  task_id: crew.task_id
                });
              }
              pending.dirty = true;
            }
          })
          .catch(err => console.error("[Dashboard] Failed to fetch batch crews:", err))
      );
    }

    await Promise.all(promises);
  }, [apiBaseUrl]);

  // Schedule batch fetch with debouncing
  const scheduleBatchFetch = useCallback(() => {
    if (batchFetchTimeoutRef.current) {
      clearTimeout(batchFetchTimeoutRef.current);
    }
    batchFetchTimeoutRef.current = setTimeout(() => {
      batchFetchTimeoutRef.current = null;
      fetchBatchData();
    }, BATCH_DEBOUNCE_MS);
  }, [fetchBatchData]);

  // Cleanup batch fetch timeout on unmount
  useEffect(() => {
    const timeoutRef = batchFetchTimeoutRef;
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Periodic fallback: poll for state if SSE appears stale
  useEffect(() => {
    const interval = setInterval(() => {
      const timeSinceLastEvent = Date.now() - lastSseEventRef.current;
      if (timeSinceLastEvent > SSE_STALE_THRESHOLD_MS) {
        console.debug("[Dashboard] SSE stale, polling for state");
        refreshRegionState();
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [refreshRegionState]);

  const handleEvent = useCallback((payload: EventPayload) => {
    const pending = pendingUpdatesRef.current;

    // Track SSE activity for stale detection (skip synthetic events)
    if (payload.event !== "connected" && payload.event !== "reconnected") {
      lastSseEventRef.current = Date.now();
    }

    switch (payload.event) {
    case "reconnected":
      // SSE reconnected after visibility change or network recovery
      // Refresh the region state to ensure we have latest data
      console.debug("[SSE] Reconnected, refreshing state");
      refreshRegionState();
      break;
    case "phase_change":
      pending.cycle = payload.data as Partial<CycleState>;
      pending.dirty = true;
      break;
    case "world_delta": {
      const data = payload.data as {
        type?: string;
        rust_changed?: string[];
        hex_ids?: string[]; // New ID-only format
        hex_updates?: { h3_index: string; rust_level: number }[]; // Legacy full data format
        regions_changed?: string[];
        region_id?: string;
        rust_level?: number;
        region_updates?: {
          region_id: string;
          pool_food: number;
          pool_equipment: number;
          pool_energy: number;
          pool_materials: number;
          rust_avg?: number | null;
          health_avg?: number | null;
          score?: number | null;
        }[];
      };

      // Handle bulk rust update (admin console)
      if (data.type === "rust_bulk") {
        console.debug("[SSE] rust_bulk received:", data, "current region:", regionRef.current.region_id);
        if (data.region_id === regionRef.current.region_id && data.rust_level !== undefined) {
          console.debug("[SSE] Setting rustBulkUpdate to:", data.rust_level);
          pending.rustBulkUpdate = data.rust_level;
          pending.dirty = true;
        }
      }

      // New ID-only format - queue for batch fetch
      if (data.hex_ids?.length) {
        const pendingBatch = pendingBatchIdsRef.current;
        for (const hexId of data.hex_ids) {
          pendingBatch.hexIds.add(hexId);
        }
        scheduleBatchFetch();
      }

      // Legacy full data format (backwards compatibility)
      if (data.hex_updates?.length) {
        for (const update of data.hex_updates) {
          pending.hexUpdates.set(update.h3_index, update);
        }
        pending.dirty = true;
      }

      if (data.region_updates?.length) {
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
            pending.resourceDeltas.push({ type: "food", delta: foodDelta, source: foodDelta > 0 ? "Transfer arrived" : "Crew expenses", ts: Date.now() });
          }
          if (equipmentDelta !== 0) {
            pending.resourceDeltas.push({ type: "equipment", delta: equipmentDelta, source: equipmentDelta > 0 ? "Transfer arrived" : "Crew expenses", ts: Date.now() });
          }
          if (energyDelta !== 0) {
            pending.resourceDeltas.push({ type: "energy", delta: energyDelta, source: energyDelta > 0 ? "Transfer arrived" : "Crew expenses", ts: Date.now() });
          }
          if (materialDelta !== 0) {
            pending.resourceDeltas.push({ type: "materials", delta: materialDelta, source: materialDelta > 0 ? "Transfer arrived" : "Crew expenses", ts: Date.now() });
          }
          pending.regionUpdate = match;
          pending.dirty = true;
        }
      }

      break;
    }
    case "resource_transfer": {
      const data = payload.data as
        | ResourceTransferPayload // Legacy full data format
        | { transfer_ids: string[] }; // New ID-only format

      // New ID-only format - queue for batch fetch
      if ('transfer_ids' in data) {
        const pendingBatch = pendingBatchIdsRef.current;
        for (const transferId of data.transfer_ids) {
          if (!spawnedTransferIdsRef.current.has(transferId)) {
            pendingBatch.transferIds.add(transferId);
          }
        }
        if (pendingBatch.transferIds.size > 0) {
          scheduleBatchFetch();
        }
        break;
      }

      // Legacy full data format (backwards compatibility)
      const transfer = data;
      if (transfer.region_id !== regionRef.current.region_id) {
        break;
      }
      // Track spawned transfer to prevent duplicates from polling refresh
      spawnedTransferIdsRef.current.add(transfer.transfer_id);
      // Dispatch for map animation
      window.dispatchEvent(new CustomEvent("nightfall:resource_transfer", { detail: transfer }));
      // Add to resource deltas for the ticker (negative since resources are in transit)
      pending.resourceDeltas.push({
        type: transfer.resource_type,
        delta: -transfer.amount,
        source: "In transit",
        ts: Date.now(),
        transferId: transfer.transfer_id,
        arriveAt: Date.parse(transfer.arrive_at)
      });
      pending.dirty = true;
      break;
    }
    case "feature_delta": {
      type FeatureDelta = { gers_id: string; health: number; status: string };
      const data = payload.data as
        | FeatureDelta // Legacy single item
        | { features: FeatureDelta[] } // Legacy batched
        | { feature_ids: string[] }; // New ID-only format

      // New ID-only format - queue for batch fetch
      if ('feature_ids' in data) {
        const pendingBatch = pendingBatchIdsRef.current;
        for (const featureId of data.feature_ids) {
          pendingBatch.featureIds.add(featureId);
        }
        scheduleBatchFetch();
        break;
      }

      // Legacy batched format
      if ('features' in data) {
        console.debug("[SSE] feature_delta batch received:", data.features.length, "updates");
        for (const delta of data.features) {
          pending.featureUpdates.set(delta.gers_id, delta);
        }
      } else {
        // Legacy single item format
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
    case "crew_delta": {
      type CrewDelta = {
        crew_id: string;
        region_id: string;
        event_type: string;
        waypoints?: { coord: [number, number]; arrive_at: string }[] | null;
        position?: { lng: number; lat: number } | null;
        task_id?: string | null;
      };

      const data = payload.data as
        | { crews: CrewDelta[] } // Legacy full data format
        | { crew_ids: string[] }; // New ID-only format

      // New ID-only format - queue for batch fetch
      if ('crew_ids' in data) {
        const pendingBatch = pendingBatchIdsRef.current;
        for (const crewId of data.crew_ids) {
          pendingBatch.crewIds.add(crewId);
        }
        scheduleBatchFetch();
        break;
      }

      // Legacy full data format
      if (!data.crews?.length) break;

      // Filter to only our region's crews
      const relevantCrews = data.crews.filter(c => c.region_id === regionRef.current.region_id);
      if (relevantCrews.length === 0) break;

      // Update crews state with new data
      for (const crewDelta of relevantCrews) {
        pending.crewUpdates.set(crewDelta.crew_id, crewDelta);
      }
      pending.dirty = true;
      break;
    }
    }
  }, [refreshRegionState, scheduleBatchFetch]);

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
          // Award score only for genuinely new votes (not changing existing votes)
          const isNewVote = currentVote === undefined;
          if (isNewVote) {
            addVoteScore(SCORE_ACTIONS.voteSubmitted);
          }
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
  }, [apiBaseUrl, auth, userVotes, setRegion, setUserVote, clearUserVote, addVoteScore]);

  // Unified handler for both quick activation and boost production minigames
  const handleStartMinigame = useCallback(async (buildingGersId: string, buildingName: string, mode: "quick" | "boost") => {
    if (!auth.clientId || !auth.token) return;

    try {
      const res = await fetch(`${apiBaseUrl}/api/minigame/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${auth.token}`
        },
        body: JSON.stringify({
          client_id: auth.clientId,
          building_gers_id: buildingGersId,
          mode
        })
      });

      const data = await res.json();

      if (data.ok) {
        startMinigame({
          session_id: data.session_id,
          building_gers_id: buildingGersId,
          building_name: buildingName,
          minigame_type: data.minigame_type,
          resource_type: data.resource_type,
          mode: data.mode,
          config: data.config,
          difficulty: data.difficulty,
          started_at: Date.now(),
        });
        setShowMinigameOverlay(true);
      } else if (data.error === "cooldown_active") {
        setCooldown({
          building_gers_id: buildingGersId,
          available_at: data.available_at,
        });
        toast.error("Cooldown active", {
          description: `Wait ${Math.ceil(data.cooldown_remaining_ms / 1000 / 60)} minutes`
        });
      } else {
        toast.error("Failed to start minigame", { description: data.error });
      }
    } catch (err) {
      console.error("Failed to start minigame", err);
      toast.error("Failed to start minigame", { description: "Please try again" });
    }
  }, [apiBaseUrl, auth, startMinigame, setCooldown]);

  const handleMinigameClose = useCallback(() => {
    setShowMinigameOverlay(false);
  }, []);

  const handleManualRepair = useCallback(async (roadGersId: string, roadClass: string) => {
    if (!auth.clientId || !auth.token) return;

    try {
      const res = await fetch(`${apiBaseUrl}/api/repair-minigame/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${auth.token}`
        },
        body: JSON.stringify({
          client_id: auth.clientId,
          road_gers_id: roadGersId
        })
      });

      const data = await res.json();

      if (data.ok) {
        startRepairMinigame({
          session_id: data.session_id,
          road_gers_id: roadGersId,
          road_class: data.road_class || roadClass,
          minigame_type: data.minigame_type,
          current_health: data.current_health,
          target_health: data.target_health,
          config: data.config,
          difficulty: data.difficulty,
          started_at: Date.now(),
        });
        setShowRepairMinigameOverlay(true);
      } else if (data.error === "road_already_healthy") {
        toast.info("Road is already healthy", { description: "No repair needed" });
      } else if (data.error === "repair_already_in_progress") {
        toast.error("Repair in progress", { description: "Someone is already repairing this road" });
      } else {
        toast.error("Failed to start repair", { description: data.error });
      }
    } catch (err) {
      console.error("Failed to start repair minigame", err);
      toast.error("Failed to start repair", { description: "Please try again" });
    }
  }, [apiBaseUrl, auth, startRepairMinigame]);

  const handleRepairMinigameClose = useCallback(() => {
    setShowRepairMinigameOverlay(false);
  }, []);

  // Direct activation handler for dev mode (skips minigame for faster testing)
  const handleDirectActivate = useCallback(async (buildingGersId: string): Promise<{ activated_at: string; expires_at: string }> => {
    if (!auth.clientId || !auth.token) {
      throw new Error("Not authenticated");
    }

    const res = await fetch(`${apiBaseUrl}/api/building/activate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${auth.token}`
      },
      body: JSON.stringify({
        client_id: auth.clientId,
        building_gers_id: buildingGersId
      })
    });

    const data = await res.json();
    if (!data.ok && !data.already_activated) {
      throw new Error(data.error || "Activation failed");
    }

    toast.success("Building activated!", { description: "Convoys will be dispatched for 2 minutes" });

    return {
      activated_at: data.activated_at,
      expires_at: data.expires_at
    };
  }, [apiBaseUrl, auth]);

  const counts = useMemo(() => {
    let roads = 0;
    let healthy = 0;
    let degraded = 0;

    for (const f of features) {
      if (f.feature_type === "road") {
        roads += 1;
        if (f.health !== undefined && f.health !== null) {
          if (f.health >= DEGRADED_HEALTH_THRESHOLD) healthy += 1;
          else degraded += 1;
        }
      }
    }

    // Count active building activations from the store
    const now = Date.now();
    const activatedBuildings = Object.values(buildingActivations).filter(
      activation => Date.parse(activation.expires_at) > now
    ).length;

    return { roads, healthy, degraded, activatedBuildings };
  }, [features, buildingActivations]);


  // Only show tasks where a crew is actively working (not traveling)
  const activeTasks = useMemo(() => {
    const workingCrews = region.crews.filter(c => c.status === "working" && c.active_task_id);
    const crewByTaskId = new Map(workingCrews.map(c => [c.active_task_id, c]));
    return region.tasks
      .filter(t => crewByTaskId.has(t.task_id))
      .map(t => ({
        ...t,
        busy_until: crewByTaskId.get(t.task_id)?.busy_until ?? null
      }));
  }, [region.crews, region.tasks]);

  // Crews that are traveling to a task or returning to hub
  const travelingCrews = useMemo(() => {
    return region.crews
      .filter(c => c.status === "traveling")
      .map(c => {
        // Find the task to get the target road
        const task = c.active_task_id
          ? region.tasks.find(t => t.task_id === c.active_task_id)
          : null;
        return {
          crew_id: c.crew_id,
          target_gers_id: task?.target_gers_id ?? null,
          busy_until: c.busy_until ?? null
        };
      });
  }, [region.crews, region.tasks]);

  const busyCrews = useMemo(() => region.crews.filter(c => c.status !== "idle").length, [region.crews]);
  const totalCrews = region.crews.length;

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
            variant="light"
          />
        </div>
      </div>

      <ActiveEvents deltas={resourceFeed} activeTasks={activeTasks} travelingCrews={travelingCrews} features={features} />

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
    <div className={`relative h-dvh overflow-hidden transition-all duration-[2500ms] ease-in-out ${phaseGlow[cycle.phase]}`}>
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
        className="h-full w-full rounded-none border-0 shadow-none"
      >
        <div className="pointer-events-none absolute inset-0">
          {cycle.phase === "dusk" && (
            <div className="pointer-events-none absolute top-36 left-1/2 z-40 -translate-x-1/2 lg:top-20">
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

          <div className="pointer-events-none absolute left-4 right-4 top-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            {/* Collapsed header */}
            <button
              type="button"
              onClick={() => setIsHeaderCollapsed(false)}
              aria-label="Expand header"
              className={`flex items-center gap-3 rounded-full border border-white/10 bg-[#0f1216]/80 px-4 py-2 text-white shadow-lg backdrop-blur-md transition-all duration-300 ${isHeaderCollapsed ? "opacity-100 pointer-events-auto" : "absolute opacity-0 pointer-events-none"}`}
            >
              <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/60">Nightfall Console</span>
              <span className="text-white/30">|</span>
              <span className="font-display text-sm">{region.name}</span>
              {isDemoMode && (
                <span className="rounded bg-red-900/50 px-1.5 py-0.5 text-[0.6rem] font-bold text-red-200">
                  DEMO
                </span>
              )}
            </button>

            {/* Full header - toggleable on both mobile and desktop */}
            <MapPanel className={`max-w-[520px] transition-all duration-300 ${isHeaderCollapsed ? "absolute opacity-0 pointer-events-none" : "opacity-100 pointer-events-auto"}`}>
              <button
                type="button"
                onClick={() => setIsHeaderCollapsed(true)}
                className="absolute right-3 top-3 rounded-full p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white/60"
                aria-label="Collapse header"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                </svg>
              </button>
              <p className="text-[10px] uppercase tracking-[0.5em] text-white/60">
                Nightfall Ops Console
                {isDemoMode && (
                  <span className="ml-3 rounded bg-red-900/50 px-2 py-0.5 text-[0.65rem] font-bold text-red-200">
                    DEMO MODE
                  </span>
                )}
                <ConnectionStatus isMapDataUnavailable={!pmtilesRelease} />
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
              <p className="mt-1 text-[10px] text-white/40">
                A demonstration of Overture Maps data
              </p>
            </MapPanel>

            <div className="pointer-events-auto flex items-start gap-3">
              <PlayerTierBadgeCompact />
              <PhaseIndicator />
            </div>
          </div>

          <MapOverlay position="top-right" className="!top-24 !bottom-4 hidden w-72 flex-col gap-4 lg:flex">
            <MapPanel title="Resource Pools" className="flex-shrink-0">
              <ResourcePoolsPanel
                poolFood={region.pool_food}
                poolEquipment={region.pool_equipment}
                poolEnergy={region.pool_energy}
                poolMaterials={region.pool_materials}
                variant="dark"
              />
            </MapPanel>

            <MapPanel title="Region Health" className="flex-shrink-0">
              <div className="flex items-center justify-around">
                <RadialStat
                  value={counts.degraded}
                  max={counts.roads}
                  label="Degraded"
                  color="#ef4444"
                  emoji="🛣️"
                  format="percent"
                />
                <RadialStat
                  value={busyCrews}
                  max={totalCrews}
                  label="Workers"
                  color="var(--night-teal)"
                  emoji="👷"
                  format="fraction"
                />
                <RadialStat
                  value={counts.activatedBuildings}
                  max={Math.max(counts.activatedBuildings, 1)}
                  label="Active"
                  color="#fbbf24"
                  emoji="🏢"
                  format="number"
                />
              </div>
            </MapPanel>

            <ActiveEvents deltas={resourceDeltas} activeTasks={activeTasks} travelingCrews={travelingCrews} features={features} />
          </MapOverlay>



          <div
            className="pointer-events-auto absolute bottom-0 left-0 right-0 bg-[color:var(--night-ink)]/90 lg:hidden"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <MobileSidebar>
              <SidebarContent resourceFeed={resourceDeltas} />
            </MobileSidebar>
          </div>

          <div className="pointer-events-auto">
            <FeaturePanel
              activeTasks={region.tasks}
              onVote={handleVote}
              onStartMinigame={handleStartMinigame}
              onDirectActivate={process.env.NODE_ENV === "development" ? handleDirectActivate : undefined}
              onManualRepair={handleManualRepair}
              canContribute={Boolean(auth.token && auth.clientId)}
              userVotes={userVotes}
            />
          </div>
        </div>
      </DemoMap>
      <OnboardingOverlay />
      {showMinigameOverlay && (activeMinigame || minigameResult) && (
        <MinigameOverlay onClose={handleMinigameClose} />
      )}
      {showRepairMinigameOverlay && (activeRepairMinigame || repairMinigameResult) && (
        <RepairMinigameOverlay onClose={handleRepairMinigameClose} />
      )}
      {process.env.NODE_ENV === "development" && <AdminConsole />}
      <PerformanceOverlay />
    </div>
  );
}
