"use client";

import { useState, useMemo, useCallback } from "react";
import DemoMap from "./DemoMap";
import PhaseIndicator from "./PhaseIndicator";
import ActivityFeed, { type FeedItem } from "./ActivityFeed";
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

type Region = {
  region_id: string;
  name: string;
  boundary: {
    type: string;
    coordinates: number[][][] | number[][][][];
  } | null;
  pool_labor: number;
  pool_materials: number;
  stats: {
    total_roads: number;
    healthy_roads: number;
    degraded_roads: number;
    rust_avg: number;
  };
};

type Hex = {
  h3_index: string;
  rust_level: number;
  boundary: any;
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

export default function Dashboard({
  initialRegion,
  initialFeatures,
  initialHexes,
  initialCycle,
  apiBaseUrl
}: DashboardProps) {
  const [region] = useState<Region>(initialRegion);
  const [features, setFeatures] = useState<Feature[]>(initialFeatures);
  const [hexes] = useState<Hex[]>(initialHexes);
  const [cycle, setCycle] = useState<CycleState>(initialCycle);
  const [lastEvent, setLastEvent] = useState<string | null>(null);

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
    }
  }, []);

  useEventStream(apiBaseUrl, handleEvent);

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
                Region Identity
              </p>
              <div className="mt-4 space-y-3 text-sm text-[color:var(--night-ash)]">
                <div>
                  <p className="text-[0.65rem] uppercase tracking-[0.3em] text-[color:var(--night-moss)]">
                    Region ID
                  </p>
                  <p className="mt-1 break-all font-medium">{region.region_id}</p>
                </div>
                <div>
                  <p className="text-[0.65rem] uppercase tracking-[0.3em] text-[color:var(--night-moss)]">
                    Center of Operations
                  </p>
                  <p className="mt-1 font-medium">{region.name}</p>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-[var(--night-outline)] bg-[color:var(--night-ink)] p-6 text-white shadow-[0_18px_40px_rgba(24,20,14,0.2)]">
              <p className="text-xs uppercase tracking-[0.4em] text-[color:var(--night-glow)]">
                Live Totals
              </p>
              <div className="mt-5 space-y-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[color:var(--night-glow)]">Road segments</span>
                  <span className="text-lg font-semibold text-white">
                    {formatNumber(counts.roads)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[color:var(--night-glow)]">Buildings</span>
                  <span className="text-lg font-semibold text-white">
                    {formatNumber(counts.buildings)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[color:var(--night-glow)]">Rust average</span>
                  <span className="text-lg font-semibold text-white">
                    {formatPercent(region.stats.rust_avg)}
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-[var(--night-outline)] bg-white/60 p-6 shadow-[0_18px_40px_rgba(24,20,14,0.12)]">
              <p className="text-xs uppercase tracking-[0.4em] text-[color:var(--night-ash)]">
                Resource Pools
              </p>
              <div className="mt-4 space-y-2 text-sm text-[color:var(--night-ash)]">
                <div className="flex items-center justify-between">
                  <span>Labor</span>
                  <span className="font-semibold">{formatNumber(region.pool_labor)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Materials</span>
                  <span className="font-semibold">{formatNumber(region.pool_materials)}</span>
                </div>
              </div>
            </div>
          </aside>

          <div className="space-y-6">
            <DemoMap 
              boundary={region.boundary} 
              features={features} 
              hexes={hexes}
              fallbackBbox={{ xmin: -68.35, ymin: 44.31, xmax: -68.15, ymax: 44.45 }}
              cycle={cycle}
            />
            
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-[var(--night-outline)] bg-white/70 px-4 py-3 text-sm text-[color:var(--night-ash)]">
                <p className="text-[0.65rem] uppercase tracking-[0.3em] text-[color:var(--night-moss)]">
                  Healthy roads
                </p>
                <p className="mt-1 text-lg font-semibold">
                  {formatNumber(counts.healthy)}
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--night-outline)] bg-white/70 px-4 py-3 text-sm text-[color:var(--night-ash)]">
                <p className="text-[0.65rem] uppercase tracking-[0.3em] text-[color:var(--night-moss)]">
                  Degraded roads
                </p>
                <p className="mt-1 text-lg font-semibold">
                  {formatNumber(counts.degraded)}
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--night-outline)] bg-white/70 px-4 py-3 text-sm text-[color:var(--night-ash)]">
                <p className="text-[0.65rem] uppercase tracking-[0.3em] text-[color:var(--night-moss)]">
                  Total features
                </p>
                <p className="mt-1 text-lg font-semibold">
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
