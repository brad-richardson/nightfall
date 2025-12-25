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
// ... (rest of constants)

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

async function fetchFeatures(bbox: Bbox): Promise<Feature[]> {
// ... (rest of functions)

export default async function HomePage() {
  const [region, world] = await Promise.all([
    fetchRegion(DEMO_REGION_ID),
    fetchWorld()
  ]);

  if (!region || !world) {
    // ... error UI
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