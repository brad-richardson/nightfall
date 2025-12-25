import Dashboard from "./components/Dashboard";

type Bbox = {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
};

type Boundary =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

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

type RegionResponse = {
  region_id: string;
  name: string;
  boundary: Boundary | null;
  pool_labor: number;
  pool_materials: number;
  stats: {
    total_roads: number;
    healthy_roads: number;
    degraded_roads: number;
    rust_avg: number;
  };
};

type WorldResponse = {
  cycle: {
    phase: "dawn" | "day" | "dusk" | "night";
    phase_progress: number;
    phase_start: string;
    next_phase: "dawn" | "day" | "dusk" | "night";
    next_phase_in_seconds: number;
  };
};

type Hex = {
  h3_index: string;
  rust_level: number;
  boundary: any;
};

const DEMO_REGION_ID = "bar_harbor_me_usa_demo";
const DEMO_BBOX: Bbox = {
  xmin: -68.35,
  ymin: 44.31,
  xmax: -68.15,
  ymax: 44.45
};

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3001";

async function fetchRegion(regionId: string): Promise<RegionResponse | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/region/${regionId}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as RegionResponse;
  } catch {
    return null;
  }
}

async function fetchWorld(): Promise<WorldResponse | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/world`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as WorldResponse;
  } catch {
    return null;
  }
}

async function fetchFeatures(bbox: Bbox): Promise<Feature[]> {
  try {
    const bboxParam = `${bbox.xmin},${bbox.ymin},${bbox.xmax},${bbox.ymax}`;
    const res = await fetch(
      `${API_BASE_URL}/api/features?bbox=${bboxParam}&types=road,building`,
      { cache: "no-store" }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { features?: Feature[] };
    return data.features ?? [];
  } catch {
    return [];
  }
}

async function fetchHexes(bbox: Bbox): Promise<Hex[]> {
  try {
    const bboxParam = `${bbox.xmin},${bbox.ymin},${bbox.xmax},${bbox.ymax}`;
    const res = await fetch(`${API_BASE_URL}/api/hexes?bbox=${bboxParam}`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    return data.hexes ?? [];
  } catch {
    return [];
  }
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

export default async function HomePage() {
  const [region, world] = await Promise.all([
    fetchRegion(DEMO_REGION_ID),
    fetchWorld()
  ]);

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

  const regionBbox = getBoundaryBbox(region.boundary) ?? DEMO_BBOX;
  const [features, hexes] = await Promise.all([
    fetchFeatures(regionBbox),
    fetchHexes(regionBbox)
  ]);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_var(--night-glow),_var(--night-sand))]">
      <Dashboard
        initialRegion={region}
        initialFeatures={features}
        initialHexes={hexes}
        initialCycle={world.cycle}
        apiBaseUrl={API_BASE_URL}
      />
    </main>
  );
}
