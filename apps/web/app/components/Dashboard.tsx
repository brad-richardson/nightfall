"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
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
  crews: {
    crew_id: string;
    status: string;
    active_task_id: string | null;
    busy_until: string | null;
  }[];
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
  availableRegions: { region_id: string; name: string }[];
  isDemoMode: boolean;
  apiBaseUrl: string;
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

async function initializeSession(apiBaseUrl: string): Promise<{ clientId: string; token: string }> {
  let clientId = localStorage.getItem("nightfall_client_id");
  if (!clientId) {
    clientId = `client_${Math.random().toString(36).slice(2, 11)}`;
    localStorage.setItem("nightfall_client_id", clientId);
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
  apiBaseUrl
}: DashboardProps) {
  const router = useRouter();
  const [region, setRegion] = useState<Region>(initialRegion);
  const [features, setFeatures] = useState<Feature[]>(initialFeatures);
  const [hexes] = useState<Hex[]>(initialHexes);
  const [cycle, setCycle] = useState<CycleState>(initialCycle);
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string>("");
  const [token, setToken] = useState<string>("");

  useEffect(() => {
    initializeSession(apiBaseUrl).then(({ clientId, token }) => {
      setClientId(clientId);
      setToken(token);
    });
  }, [apiBaseUrl]);

  const handleEvent = useCallback((payload: EventPayload) => {
// ...
  const handleVote = useCallback(async (taskId: string, weight: number) => {
    if (!clientId || !token) return;
    try {
      const res = await fetch(`${apiBaseUrl}/api/vote`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ client_id: clientId, task_id: taskId, weight })
      });
      if (res.ok) {
// ...
  const handleContribute = useCallback(async (labor: number, materials: number) => {
    if (!clientId || !token) return;
    try {
      const res = await fetch(`${apiBaseUrl}/api/contribute`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ 
          client_id: clientId, 
          region_id: region.region_id, 
          labor, 
          materials 
        })
      });
      if (res.ok) {


  const counts = useMemo(() => {
    let roads = 0;
// ...
    return { roads, buildings, healthy, degraded };
  }, [features]);

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
          </div>
          
          <div className="flex items-center gap-4">
            <PhaseIndicator cycle={cycle} />
            <div className="rounded-full border border-[var(--night-outline)] bg-white/70 px-4 py-2 text-[10px] uppercase tracking-[0.4em] text-[color:var(--night-teal)]">
              {lastEvent ? `Live: ${lastEvent}` : "Connecting..."}
            </div>
          </div>
        </header>

        <section className="mt-10 grid gap-8 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-6 order-2 lg:order-1">
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

          <div className="relative space-y-6 order-1 lg:order-2">
            <DemoMap 
              features={features} 
              hexes={hexes}
              crews={region.crews}
              tasks={region.tasks}
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
