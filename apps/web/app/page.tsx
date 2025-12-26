"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Dashboard from "./components/Dashboard";
import { type Region, type Feature, type Hex } from "./store";
import { BAR_HARBOR_DEMO_BBOX, type Bbox } from "@nightfall/config";
import { fetchWithRetry } from "./lib/retry";

type Boundary =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

type RegionResponse = Region;

type OvertureResponse = { ok: boolean; release?: string };

type WorldResponse = {
  demo_mode: boolean;
  cycle: {
    phase: "dawn" | "day" | "dusk" | "night";
    phase_progress: number;
    phase_start: string;
    next_phase: "dawn" | "day" | "dusk" | "night";
    next_phase_in_seconds: number;
  };
  regions: {
    region_id: string;
    name: string;
  }[];
};

const DEMO_REGION_ID = "bar_harbor_me_usa_demo";
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
const FETCH_RETRY_OPTIONS = { attempts: 3, baseDelayMs: 250, maxDelayMs: 2000, jitter: 0.2 };

async function fetchRegion(apiBaseUrl: string, regionId: string): Promise<RegionResponse | null> {
  try {
    const res = await fetchWithRetry(
      `${apiBaseUrl}/api/region/${regionId}`,
      { cache: "no-store" },
      FETCH_RETRY_OPTIONS
    );
    if (!res.ok) return null;
    return (await res.json()) as RegionResponse;
  } catch {
    return null;
  }
}

async function fetchWorld(apiBaseUrl: string): Promise<WorldResponse | null> {
  try {
    const res = await fetchWithRetry(
      `${apiBaseUrl}/api/world`,
      { cache: "no-store" },
      FETCH_RETRY_OPTIONS
    );
    if (!res.ok) return null;
    return (await res.json()) as WorldResponse;
  } catch {
    return null;
  }
}

async function fetchFeatures(apiBaseUrl: string, bbox: Bbox): Promise<Feature[]> {
  try {
    const bboxParam = `${bbox.xmin},${bbox.ymin},${bbox.xmax},${bbox.ymax}`;
    const res = await fetchWithRetry(
      `${apiBaseUrl}/api/features?bbox=${bboxParam}&types=road,building`,
      { cache: "no-store" },
      FETCH_RETRY_OPTIONS
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { features?: Feature[] };
    return data.features ?? [];
  } catch {
    return [];
  }
}

async function fetchHexes(apiBaseUrl: string, bbox: Bbox): Promise<Hex[]> {
  try {
    const bboxParam = `${bbox.xmin},${bbox.ymin},${bbox.xmax},${bbox.ymax}`;
    const res = await fetchWithRetry(
      `${apiBaseUrl}/api/hexes?bbox=${bboxParam}`,
      { cache: "no-store" },
      FETCH_RETRY_OPTIONS
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.hexes ?? [];
  } catch {
    return [];
  }
}

async function fetchOvertureRelease(apiBaseUrl: string): Promise<string | null> {
  try {
    const res = await fetchWithRetry(
      `${apiBaseUrl}/api/overture-latest`,
      { cache: "no-store" },
      FETCH_RETRY_OPTIONS
    );
    if (res.ok) {
      const data = (await res.json()) as OvertureResponse;
      if (data.release) return data.release;
    }
  } catch {
    // ignore and fall back
  }
  return null;
}

function getBoundaryBbox(boundary: Boundary | null): Bbox | null {
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

function HomePageContent({ regionId }: { regionId: string }) {

  const [region, setRegion] = useState<Region | null>(null);
  const [world, setWorld] = useState<WorldResponse | null>(null);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [hexes, setHexes] = useState<Hex[]>([]);
  const [overtureRelease, setOvertureRelease] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setRegion(null);
      setWorld(null);
      setFeatures([]);
      setHexes([]);
      setOvertureRelease(null);

      const [nextRegion, nextWorld] = await Promise.all([
        fetchRegion(API_BASE_URL, regionId),
        fetchWorld(API_BASE_URL)
      ]);

      if (cancelled) return;
      setRegion(nextRegion);
      setWorld(nextWorld);

      if (!nextRegion || !nextWorld) return;

      const regionBbox = getBoundaryBbox(nextRegion.boundary) ?? BAR_HARBOR_DEMO_BBOX;
      const [nextFeatures, nextHexes, nextRelease] = await Promise.all([
        fetchFeatures(API_BASE_URL, regionBbox),
        fetchHexes(API_BASE_URL, regionBbox),
        fetchOvertureRelease(API_BASE_URL)
      ]);

      if (cancelled) return;
      setFeatures(nextFeatures);
      setHexes(nextHexes);
      setOvertureRelease(nextRelease);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [regionId]);

  if (!region || !world) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[color:var(--night-sand)] text-[color:var(--night-ink)]">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Awaiting Data...</h1>
          <p className="mt-2 opacity-60">The Nightfall services are initializing.</p>
        </div>
      </main>
    );
  }

  if (!overtureRelease) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[color:var(--night-sand)] text-[color:var(--night-ink)]">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Awaiting Map Data...</h1>
          <p className="mt-2 opacity-60">Overture tiles are temporarily unavailable.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_var(--night-glow),_var(--night-sand))]">
      <Dashboard
        initialRegion={region}
        initialFeatures={features}
        initialHexes={hexes}
        initialCycle={world.cycle}
        availableRegions={world.regions}
        isDemoMode={world.demo_mode}
        apiBaseUrl={API_BASE_URL}
        pmtilesRelease={overtureRelease}
      />
    </main>
  );
}

function SearchParamsWrapper() {
  const searchParams = useSearchParams();
  const regionId = searchParams.get("region") ?? DEMO_REGION_ID;
  return <HomePageContent regionId={regionId} />;
}

export default function HomePage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,_var(--night-glow),_var(--night-sand))] flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </main>
    }>
      <SearchParamsWrapper />
    </Suspense>
  );
}
