"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import DemoMap from "./DemoMap";
import PhaseIndicator from "./PhaseIndicator";
import ActivityFeed, { type FeedItem } from "./ActivityFeed";
import TaskList from "./TaskList";
import FeaturePanel from "./FeaturePanel";
import { useEventStream, type EventPayload } from "../hooks/useEventStream";

type Phase = "dawn" | "day" | "dusk" | "night";

type CycleState = {
  phase: Phase;
  phase_progress: number;
  next_phase: Phase;
  next_phase_in_seconds: number;
};

type Feature = {
  gers_id: string;
  feature_type: string;
  bbox: [number, number, number, number] | null;
  health?: number | null;
  status?: string | null;
  road_class?: string | null;
  place_category?: string | null;
  generates_labor?: boolean;
  generates_materials?: boolean;
};

type Task = {
  task_id: string;
  target_gers_id: string;
  priority_score: number;
  status: string;
  vote_score: number;
  cost_labor: number;
  cost_materials: number;
  duration_s: number;
  repair_amount: number;
  task_type: string;
};

type Boundary =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

type Region = {
  region_id: string;
  name: string;
  boundary: Boundary | null;
  pool_labor: number;
  pool_materials: number;
  tasks: Task[];
  stats: {
    total_roads: number;
    healthy_roads: number;
    degraded_roads: number;
    rust_avg: number;
    health_avg: number;
  };
};

type Hex = {
  h3_index: string;
  rust_level: number;
};

type DashboardProps = {
  initialRegion: Region;
  initialFeatures: Feature[];
  initialHexes: Hex[];
  initialCycle: CycleState;
  apiBaseUrl: string;
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function getOrCreateClientId() {
  if (typeof window === "undefined") return "server";
  let id = localStorage.getItem("nightfall_client_id");
  if (!id) {
    id = `client_${Math.random().toString(36).slice(2, 11)}`;
    localStorage.setItem("nightfall_client_id", id);
  }
  return id;
}

export default function Dashboard({
  initialRegion,
  initialFeatures,
  initialHexes,
  initialCycle,
  apiBaseUrl
}: DashboardProps) {
  const [region, setRegion] = useState<Region>(initialRegion);
  const [features, setFeatures] = useState<Feature[]>(initialFeatures);
  const [hexes, setHexes] = useState<Hex[]>(initialHexes);
  const [cycle, setCycle] = useState<CycleState>(initialCycle);
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string>("");

  useEffect(() => {
    setClientId(getOrCreateClientId());
  }, []);

  const handleEvent = useCallback((payload: EventPayload) => {
    setLastEvent(`${payload.event} @ ${new Date().toLocaleTimeString()}`);

    switch (payload.event) {
      case "phase_change":
        setCycle(payload.data as CycleState);
        break;
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
        const delta = payload.data as { task_id: string; status: string; priority_score: number };
        setRegion((prev) => {
          const taskExists = prev.tasks.some(t => t.task_id === delta.task_id);
          if (taskExists) {
            return {
              ...prev,
              tasks: prev.tasks.map(t => 
                t.task_id === delta.task_id 
                  ? { ...t, status: delta.status, priority_score: delta.priority_score } 
                  : t
              ).filter(t => t.status !== 'done' && t.status !== 'expired')
            };
          }
          return prev;
        });
        break;
      }
    }
  }, []);

  useEventStream(apiBaseUrl, handleEvent);

  const handleVote = useCallback(async (taskId: string, weight: number) => {
    if (!clientId) return;
    try {
      const res = await fetch(`${apiBaseUrl}/api/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, task_id: taskId, weight })
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
  }, [apiBaseUrl, clientId]);

  const handleContribute = useCallback(async (labor: number, materials: number) => {
    if (!clientId) return;
    try {
      const res = await fetch(`${apiBaseUrl}/api/contribute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          client_id: clientId, 
          region_id: region.region_id, 
          labor, 
          materials 
        })
      });
      if (res.ok) {
        const data = await res.json();
        setRegion(prev => ({
          ...prev,
          pool_labor: Number(data.new_pool_labor),
          pool_materials: Number(data.new_pool_materials)
        }));
      }
    } catch (err) {
      console.error("Failed to contribute", err);
    }
  }, [apiBaseUrl, clientId, region.region_id]);

  const counts = useMemo(() => {
    let roads = 0;
    let buildings = 0;
    let healthy = 0;
    let degraded = 0;

    for (const f of features) {
      if (f.feature_type === "road") {
        roads += 1;
        if (f.health !== undefined && f.health !== null) {
          if (f.health > 80) healthy += 1;
          if (f.health < 30) degraded += 1;
        }
      } else if (f.feature_type === "building") {
        buildings += 1;
      }
    }

    return { roads, buildings, healthy, degraded };
  }, [features]);

  return (
    <div className="flex min-h-screen flex-col">
      <div className="relative flex-1 px-6 pb-16 pt-10 lg:px-12">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_20%,rgba(221,122,73,0.12),transparent_55%),radial-gradient(circle_at_80%_0%,rgba(44,101,117,0.16),transparent_50%)]" />
        
        <header className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <p className="text-xs uppercase tracking-[0.5em] text-[color:var(--night-ash)]">
              Nightfall Ops Console
            </p>
            <h1 className="font-display mt-3 text-4xl text-[color:var(--night-ink)] sm:text-5xl">
              {region.name}
            </h1>
          </div>
          
          <div className="flex items-center gap-4">
            <PhaseIndicator cycle={cycle} />
            <div className="rounded-full border border-[var(--night-outline)] bg-white/70 px-4 py-2 text-[10px] uppercase tracking-[0.4em] text-[color:var(--night-teal)]">
              {lastEvent ? `Live: ${lastEvent}` : "Connecting..."}
            </div>
          </div>
        </header>

        <section className="mt-10 grid gap-8 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-6">
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
            </div>

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
          </aside>

          <div className="relative space-y-6">
            <DemoMap 
              boundary={region.boundary} 
              features={features} 
              hexes={hexes}
              fallbackBbox={{ xmin: -68.35, ymin: 44.31, xmax: -68.15, ymax: 44.45 }}
              cycle={cycle}
            />
            
            <FeaturePanel 
              activeTasks={region.tasks} 
              onVote={handleVote} 
              onContribute={handleContribute} 
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
          </div>
        </section>
      </div>

      <footer className="sticky bottom-0 z-50">
        <ActivityFeed />
      </footer>
    </div>
  );
}
