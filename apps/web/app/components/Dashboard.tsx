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
  // ... (existing properties)
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

// ... (format functions)

export default function Dashboard({
  initialRegion,
  initialFeatures,
  initialHexes,
  initialCycle,
  apiBaseUrl
}: DashboardProps) {
  const [region] = useState<Region>(initialRegion);
  const [features, setFeatures] = useState<Feature[]>(initialFeatures);
  const [hexes, setHexes] = useState<Hex[]>(initialHexes);
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
      case "world_delta": {
        // payload.data might contain rust_changed: [h3_index]
        // For a true implementation, we'd fetch updated hexes here
        break;
      }
    }
  }, []);

  useEventStream(apiBaseUrl, handleEvent);

  // ... (counts useMemo)

  return (
    <div className="flex min-h-screen flex-col">
      <div className="relative flex-1 px-6 pb-16 pt-10 lg:px-12">
        {/* ... (header) ... */}
        <section className="mt-10 grid gap-8 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-6">
            {/* ... (aside content) ... */}
          </aside>

          <div className="space-y-6">
            <DemoMap 
              boundary={region.boundary} 
              features={features} 
              hexes={hexes}
              fallbackBbox={{ xmin: -68.35, ymin: 44.31, xmax: -68.15, ymax: 44.45 }}
              cycle={cycle}
            />
            {/* ... (stats grid) ... */}
          </div>
        </section>
      </div>
      {/* ... (footer) ... */}
    </div>
  );
}