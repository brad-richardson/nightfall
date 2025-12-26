"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import DemoMap from "./DemoMap";
import PhaseIndicator from "./PhaseIndicator";
import ActivityFeed, { type FeedItem } from "./ActivityFeed";
import TaskList from "./TaskList";
import FeaturePanel from "./FeaturePanel";
import MobileSidebar from "./MobileSidebar";
import { useEventStream, type EventPayload } from "../hooks/useEventStream";
import { useStore, type Region, type Feature, type Hex, type CycleState } from "../store";
import { BAR_HARBOR_DEMO_BBOX, type Bbox } from "@nightfall/config";

type ResourceDelta = {
  type: "labor" | "materials";
  delta: number;
  source: string;
  ts: number;
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

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function ResourceTicker({ deltas }: { deltas: ResourceDelta[] }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-white/20 bg-[rgba(12,16,20,0.65)] px-4 py-3 shadow-[0_12px_30px_rgba(0,0,0,0.35)] backdrop-blur-md">
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
                    {item.type === "labor" ? "Labor" : "Materials"} {item.delta > 0 ? "added" : "spent"} {Math.abs(Math.round(item.delta))}
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

function getBoundaryBbox(boundary: Region["boundary"] | null): Bbox | null {
  if (!boundary) return null;
  const coords = boundary.type === "Polygon" ? boundary.coordinates.flat() : boundary.coordinates.flat(2);
  if (coords.length === 0) return null;

  let xmin = Number.POSITIVE_INFINITY;
  let ymin = Number.POSITIVE_INFINITY;
  let xmax = Number.NEGATIVE_INFINITY;
  let ymax = Number.NEGATIVE_INFINITY;

  for (const [lon, lat] of coords) {
    xmin = Math.min(xmin, lon);
    ymin = Math.min(ymin, lat);
    xmax = Math.max(xmax, lon);
    ymax = Math.max(ymax, lat);
  }
  return { xmin, ymin, xmax, ymax };
}

async function initializeSession(apiBaseUrl: string): Promise<{ clientId: string; token: string }> {
  let clientId = typeof window !== 'undefined' ? localStorage.getItem("nightfall_client_id") : null;
  if (!clientId) {
    clientId = `client_${Math.random().toString(36).slice(2, 11)}`;
    if (typeof window !== 'undefined') localStorage.setItem("nightfall_client_id", clientId);
  }

  try {
    const res = await fetch(`${apiBaseUrl}/api/hello`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId })
    });
    
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
  
  // Store hooks
  const region = useStore((state) => state.region);
  const setRegion = useStore((state) => state.setRegion);
  const features = useStore((state) => state.features);
  const setFeatures = useStore((state) => state.setFeatures);
  const hexes = useStore((state) => state.hexes);
  const setHexes = useStore((state) => state.setHexes);
  const cycle = useStore((state) => state.cycle);
  const setCycle = useStore((state) => state.setCycle);
  const auth = useStore((state) => state.auth);
  const setAuth = useStore((state) => state.setAuth);
  
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const [resourceDeltas, setResourceDeltas] = useState<ResourceDelta[]>([]);
  const [completedTaskIds, setCompletedTaskIds] = useState<string[]>([]);
  const prevTasksRef = useRef<Map<string, string>>(new Map());

  // Hydrate store
  useEffect(() => {
    useStore.setState({ 
      region: initialRegion,
      features: initialFeatures,
      hexes: initialHexes,
      cycle: initialCycle,
      availableRegions,
      isDemoMode
    });
  }, [initialRegion, initialFeatures, initialHexes, initialCycle, availableRegions, isDemoMode]);

  useEffect(() => {
    initializeSession(apiBaseUrl).then((authData) => {
      setAuth(authData);
    });
  }, [apiBaseUrl, setAuth]);

  const fetchRegionData = useCallback(async (regionId: string): Promise<Region | null> => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/region/${regionId}`, { cache: "no-store" });
      if (!res.ok) return null;
      return (await res.json()) as Region;
    } catch {
      return null;
    }
  }, [apiBaseUrl]);

  const fetchFeaturesInBbox = useCallback(async (bbox: Bbox): Promise<Feature[]> => {
    try {
      const bboxParam = `${bbox.xmin},${bbox.ymin},${bbox.xmax},${bbox.ymax}`;
      const res = await fetch(
        `${apiBaseUrl}/api/features?bbox=${bboxParam}&types=road,building`,
        { cache: "no-store" }
      );
      if (!res.ok) return [];
      const data = await res.json();
      return data.features ?? [];
    } catch {
      return [];
    }
  }, [apiBaseUrl]);

  const fetchHexesInBbox = useCallback(async (bbox: Bbox): Promise<Hex[]> => {
    try {
      const bboxParam = `${bbox.xmin},${bbox.ymin},${bbox.xmax},${bbox.ymax}`;
      const res = await fetch(`${apiBaseUrl}/api/hexes?bbox=${bboxParam}`, { cache: "no-store" });
      if (!res.ok) return [];
      const data = await res.json();
      return data.hexes ?? [];
    } catch {
      return [];
    }
  }, [apiBaseUrl]);

  const refreshRegionData = useCallback(async (regionId: string) => {
    const regionData = await fetchRegionData(regionId);
    if (!regionData) return;

    const bbox = getBoundaryBbox(regionData.boundary) ?? BAR_HARBOR_DEMO_BBOX;
    const [featureData, hexData] = await Promise.all([
      fetchFeaturesInBbox(bbox),
      fetchHexesInBbox(bbox)
    ]);

    setRegion(regionData);
    setFeatures(featureData);
    setHexes(hexData);
  }, [fetchFeaturesInBbox, fetchHexesInBbox, fetchRegionData, setFeatures, setHexes, setRegion]);

  const pushResourceDelta = useCallback((type: "labor" | "materials", delta: number, source: string) => {
    if (delta === 0) return;
    setResourceDeltas((prev) => [{ type, delta, source, ts: Date.now() }, ...prev].slice(0, 6));
  }, []);

  const handleEvent = useCallback((payload: EventPayload) => {
    setLastEvent(`${payload.event} @ ${new Date().toLocaleTimeString()}`);

    switch (payload.event) {
      case "phase_change":
        setCycle((prev) => {
          const incoming = payload.data as Partial<CycleState>;
          return {
            ...prev,
            ...incoming,
            phase_progress: incoming.phase_progress ?? prev.phase_progress
          };
        });
        break;
      case "world_delta": {
        const data = payload.data as {
          rust_changed?: string[];
          hex_updates?: { h3_index: string; rust_level: number }[];
          regions_changed?: string[];
          region_updates?: {
            region_id: string;
            pool_labor: number;
            pool_materials: number;
            rust_avg?: number | null;
            health_avg?: number | null;
          }[];
        };

        if (data.hex_updates?.length) {
          setHexes((prev) => {
            const map = new Map(prev.map((h) => [h.h3_index, h]));
            for (const update of data.hex_updates ?? []) {
              map.set(update.h3_index, { h3_index: update.h3_index, rust_level: update.rust_level });
            }
            return Array.from(map.values());
          });
        }

        if (data.region_updates?.length) {
          const match = data.region_updates.find((r) => r.region_id === region.region_id);
          if (match) {
            const laborDelta = match.pool_labor - region.pool_labor;
            const materialDelta = match.pool_materials - region.pool_materials;
            if (laborDelta !== 0) pushResourceDelta("labor", laborDelta, "Daily ops");
            if (materialDelta !== 0) pushResourceDelta("materials", materialDelta, "Daily ops");
            setRegion((prev) => ({
              ...prev,
              pool_labor: match.pool_labor,
              pool_materials: match.pool_materials,
              stats: {
                ...prev.stats,
                rust_avg: match.rust_avg ?? prev.stats.rust_avg,
                health_avg: match.health_avg ?? prev.stats.health_avg
              }
            }));
          }
        }

        break;
      }
      case "feed_item": {
        const item = payload.data as FeedItem;
        window.dispatchEvent(new CustomEvent("nightfall:feed_item", { detail: item }));
        break;
      }
      case "feature_delta": {
        const delta = payload.data as { gers_id: string; health: number; status: string };
        setFeatures((prev) =>
          prev.map((f) =>
            f.gers_id === delta.gers_id
              ? { ...f, health: delta.health, status: delta.status }
              : f
          )
        );
        break;
      }
      case "task_delta": {
        const delta = payload.data as {
          task_id: string;
          status: string;
          priority_score: number;
          vote_score?: number;
          cost_labor?: number;
          cost_materials?: number;
          duration_s?: number;
          repair_amount?: number;
          task_type?: string;
          target_gers_id?: string;
          region_id?: string;
        };

        // Check if this task just completed
        const prevStatus = prevTasksRef.current.get(delta.task_id);
        if (delta.status === 'done' && prevStatus && prevStatus !== 'done') {
          // Task just completed - show toast and trigger animation
          toast.success("Repair Complete!", {
            description: `Road segment restored to full health`,
            duration: 4000
          });

          // Track completed task for map animation
          if (delta.target_gers_id) {
            setCompletedTaskIds(prev => [...prev, delta.target_gers_id!]);
            // Clear after animation
            setTimeout(() => {
              setCompletedTaskIds(prev => prev.filter(id => id !== delta.target_gers_id));
            }, 3000);

            // Emit event for map animation
            window.dispatchEvent(new CustomEvent("nightfall:task_completed", {
              detail: { gers_id: delta.target_gers_id }
            }));
          }
        }

        // Track status for next comparison
        prevTasksRef.current.set(delta.task_id, delta.status);

        setRegion((prev) => {
          const taskExists = prev.tasks.some(t => t.task_id === delta.task_id);
          if (taskExists) {
            return {
              ...prev,
              tasks: prev.tasks.map(t =>
                t.task_id === delta.task_id
                  ? { ...t, ...delta }
                  : t
              ).filter(t => t.status !== 'done' && t.status !== 'expired')
            };
          }
          if (delta.region_id && delta.target_gers_id) {
            // New task - track it
            prevTasksRef.current.set(delta.task_id, delta.status);
            return {
              ...prev,
              tasks: [
                ...prev.tasks,
                {
                  task_id: delta.task_id,
                  status: delta.status,
                  priority_score: delta.priority_score,
                  vote_score: delta.vote_score ?? 0,
                  cost_labor: delta.cost_labor ?? 0,
                  cost_materials: delta.cost_materials ?? 0,
                  duration_s: delta.duration_s ?? 0,
                  repair_amount: delta.repair_amount ?? 0,
                  task_type: delta.task_type ?? "unknown",
                  target_gers_id: delta.target_gers_id,
                  region_id: delta.region_id
                }
              ]
            };
          }
          return prev;
        });
        break;
      }
    }
  }, [region.region_id, setCycle, setFeatures, setHexes, setRegion]);

  useEventStream(apiBaseUrl, handleEvent);

  const handleVote = useCallback(async (taskId: string, weight: number) => {
    if (!auth.clientId || !auth.token) return;
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
            t.task_id === taskId ? { ...t, vote_score: data.new_vote_score } : t
          )
        }));
      }
    } catch (err) {
      console.error("Failed to vote", err);
    }
  }, [apiBaseUrl, auth, setRegion]);

  const handleContribute = useCallback(async (labor: number, materials: number) => {
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
          labor, 
          materials 
        })
      });
      if (res.ok) {
        const data = await res.json();
        setRegion(prev => {
          const laborDelta = Number(data.new_pool_labor) - prev.pool_labor;
          const materialDelta = Number(data.new_pool_materials) - prev.pool_materials;
          if (laborDelta !== 0) pushResourceDelta("labor", laborDelta, "Player contribution");
          if (materialDelta !== 0) pushResourceDelta("materials", materialDelta, "Player contribution");
          return {
            ...prev,
            pool_labor: Number(data.new_pool_labor),
            pool_materials: Number(data.new_pool_materials)
          };
        });
      }
    } catch (err) {
      console.error("Failed to contribute", err);
    }
  }, [apiBaseUrl, auth, region.region_id, setRegion, pushResourceDelta]);

  const counts = useMemo(() => {
    let roads = 0;
    let buildings = 0;
    let healthy = 0;
    let degraded = 0;
    let laborBuildings = 0;
    let materialBuildings = 0;

    for (const f of features) {
      if (f.feature_type === "road") {
        roads += 1;
        if (f.health !== undefined && f.health !== null) {
          if (f.health > 80) healthy += 1;
          if (f.health < 30) degraded += 1;
        }
      } else if (f.feature_type === "building") {
        buildings += 1;
        if (f.generates_labor) laborBuildings += 1;
        if (f.generates_materials) materialBuildings += 1;
      }
    }

    return { roads, buildings, healthy, degraded, laborBuildings, materialBuildings };
  }, [features]);

  const SidebarContent = ({ resourceFeed }: { resourceFeed: ResourceDelta[] }) => (
    <>
      <div className="rounded-3xl border border-[var(--night-outline)] bg-white/70 p-6 shadow-[0_18px_40px_rgba(24,20,14,0.12)]">
        <p className="text-xs uppercase tracking-[0.4em] text-[color:var(--night-ash)]">
          Resource Pools
        </p>
        <div className="mt-4 space-y-4 text-sm text-[color:var(--night-ash)]">
          <div className="space-y-1">
            <div className="flex justify-between">
              <span>Labor</span>
              <span className="font-bold">{formatNumber(region.pool_labor)}</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-black/10 overflow-hidden">
              <div className="h-full bg-[color:var(--night-teal)] shadow-[0_0_8px_var(--night-teal)] transition-all duration-500" style={{ width: `${Math.min(100, (region.pool_labor / 1000) * 100)}%` }} />
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between">
              <span>Materials</span>
              <span className="font-bold">{formatNumber(region.pool_materials)}</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-black/10 overflow-hidden">
              <div className="h-full bg-[color:var(--night-glow)] shadow-[0_0_8px_var(--night-glow)] transition-all duration-500" style={{ width: `${Math.min(100, (region.pool_materials / 1000) * 100)}%` }} />
            </div>
          </div>
        </div>

        <div className="mt-4 text-[11px] text-[color:var(--night-ash)]">
          <p className="font-semibold text-[color:var(--night-ink)]">Contributing buildings</p>
          <p>Labor: {formatNumber(counts.laborBuildings)} • Materials: {formatNumber(counts.materialBuildings)}</p>
        </div>
      </div>

      <ResourceTicker deltas={resourceFeed} />

      <div className="rounded-3xl border border-[var(--night-outline)] bg-[color:var(--night-ink)] p-6 text-white shadow-[0_18px_40px_rgba(24,20,14,0.2)]">
        <TaskList tasks={region.tasks} onVote={handleVote} />
      </div>

      <div className="rounded-3xl border border-[var(--night-outline)] bg-white/70 p-6 shadow-[0_18px_40px_rgba(24,20,14,0.12)]">
        <p className="text-xs uppercase tracking-[0.4em] text-[color:var(--night-ash)]">
          Region Health
        </p>
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-[color:var(--night-ash)]">Avg Health</span>
            <span className="font-semibold text-[color:var(--night-ink)]">
              {formatPercent(region.stats.health_avg / 100)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-[color:var(--night-ash)]">Rust Level</span>
            <span className="font-semibold text-[color:var(--night-ink)]">
              {formatPercent(region.stats.rust_avg)}
            </span>
          </div>
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

  return (
    <div className={`flex min-h-screen flex-col transition-all duration-[2000ms] ${phaseGlow[cycle.phase]}`}>
      <div className="relative flex-1 px-6 pb-16 pt-10 lg:px-12">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_20%,rgba(221,122,73,0.12),transparent_55%),radial-gradient(circle_at_80%_0%,rgba(44,101,117,0.16),transparent_50%)]" />
        
        {cycle.phase === "dusk" && (
          <div className="mb-6 flex w-full justify-center">
            <div className="animate-pulse rounded-full border border-amber-500/50 bg-amber-900/80 px-6 py-2 text-xs font-bold uppercase tracking-[0.2em] text-amber-200 shadow-[0_0_20px_rgba(245,158,11,0.4)] backdrop-blur-md">
              Warning: Nightfall Imminent ({formatTime(cycle.next_phase_in_seconds)})
            </div>
          </div>
        )}

        {cycle.phase === "dawn" && cycle.phase_progress < 0.2 && (
          <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center">
            <div className="animate-[fade-out_4s_ease-out_forwards] text-center">
              <h2 className="text-4xl font-bold uppercase tracking-[0.5em] text-amber-100 opacity-0 blur-xl animate-[reveal_4s_ease-out_forwards]">
                The Sun Rises
              </h2>
            </div>
          </div>
        )}

        <header className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <p className="text-xs uppercase tracking-[0.5em] text-[color:var(--night-ash)]">
              Nightfall Ops Console
              {isDemoMode && (
                <span className="ml-3 rounded bg-red-900/50 px-2 py-0.5 text-[0.65rem] font-bold text-red-200">
                  DEMO MODE
                </span>
              )}
            </p>
            <div className="flex items-center gap-4">
              <h1 className="font-display mt-3 text-4xl text-[color:var(--night-ink)] sm:text-5xl">
                {region.name}
              </h1>
              {availableRegions?.length > 1 && (
                <select
                  className="mt-3 rounded-lg border border-[var(--night-outline)] bg-white/50 px-3 py-2 text-sm backdrop-blur-sm transition-colors hover:bg-white/80 focus:outline-none focus:ring-2 focus:ring-[var(--night-teal)]"
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
            <h2 className="mt-2 text-sm font-medium tracking-[0.2em] text-[color:var(--night-moss)] uppercase">
              The city endures. The nights get longer.
            </h2>
          </div>
          
          <div className="flex items-center gap-4">
            <PhaseIndicator />
            <div className="rounded-full border border-[var(--night-outline)] bg-white/70 px-4 py-2 text-[10px] uppercase tracking-[0.4em] text-[color:var(--night-teal)]">
              {lastEvent ? `Live: ${lastEvent}` : "Connecting..."}
            </div>
          </div>
        </header>

        <section className="mt-10 lg:grid lg:gap-8 lg:grid-cols-[320px_minmax(0,1fr)]">
          {/* Desktop Sidebar */}
      <aside className="hidden space-y-6 lg:block">
            <SidebarContent resourceFeed={resourceDeltas} />
          </aside>

          <div className="relative space-y-6">
            <DemoMap 
              boundary={region.boundary}
              features={features} 
              hexes={hexes}
              crews={region.crews}
              tasks={region.tasks}
              fallbackBbox={BAR_HARBOR_DEMO_BBOX}
              cycle={cycle}
              pmtilesRelease={pmtilesRelease}
            />
            
            <FeaturePanel 
              activeTasks={region.tasks} 
              onVote={handleVote} 
              onContribute={handleContribute}
              canContribute={Boolean(auth.token && auth.clientId)}
            />

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-[var(--night-outline)] bg-white/70 px-4 py-3 text-sm text-[color:var(--night-ash)]">
                <p className="text-[0.65rem] uppercase tracking-[0.3em] text-[color:var(--night-moss)]">
                  Healthy roads
                </p>
                <p className="mt-1 text-lg font-semibold text-[color:var(--night-teal)]">
                  {formatNumber(counts.healthy)}
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--night-outline)] bg-white/70 px-4 py-3 text-sm text-[color:var(--night-ash)]">
                <p className="text-[0.65rem] uppercase tracking-[0.3em] text-[color:var(--night-moss)]">
                  Degraded roads
                </p>
                <p className="mt-1 text-lg font-semibold text-red-600">
                  {formatNumber(counts.degraded)}
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--night-outline)] bg-white/70 px-4 py-3 text-sm text-[color:var(--night-ash)]">
                <p className="text-[0.65rem] uppercase tracking-[0.3em] text-[color:var(--night-moss)]">
                  Total features
                </p>
                <p className="mt-1 text-lg font-semibold text-[color:var(--night-ink)]">
                  {formatNumber(features.length)}
                </p>
              </div>
            </div>

            {/* Mobile Sidebar Trigger */}
            <div className="lg:hidden">
              <MobileSidebar>
                <SidebarContent resourceFeed={resourceDeltas} />
              </MobileSidebar>
            </div>
          </div>
        </section>

        <div className="mt-12 border-t border-[var(--night-outline)] pt-8 text-[10px] text-[color:var(--night-ash)] opacity-60">
          <p className="mb-2 uppercase tracking-widest">Attribution</p>
          <div className="space-y-1">
            <p>Data from Overture Maps Foundation (CDLA Permissive v2.0)</p>
            <p>H3 geospatial indexing system (Apache 2.0)</p>
            <p>Map data © OpenStreetMap contributors</p>
          </div>
        </div>
      </div>

      <footer className="sticky bottom-0 z-50">
        <ActivityFeed />
      </footer>
    </div>
  );
}
