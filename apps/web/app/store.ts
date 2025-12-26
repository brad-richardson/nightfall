import { create } from "zustand";

export type Phase = "dawn" | "day" | "dusk" | "night";

export type CycleState = {
  phase: Phase;
  phase_progress: number;
  next_phase: Phase;
  next_phase_in_seconds: number;
};

export type Feature = {
  gers_id: string;
  feature_type: string;
  bbox: [number, number, number, number] | null;
  geometry?: { 
    type: "Point" | "LineString" | "Polygon" | "MultiPolygon"; 
    coordinates: number[] | number[][] | number[][][] | number[][][][];
  } | null;
  health?: number | null;
  status?: string | null;
  road_class?: string | null;
  place_category?: string | null;
  generates_labor?: boolean;
  generates_materials?: boolean;
};

export type Task = {
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

export type Crew = {
  crew_id: string;
  status: string;
  active_task_id: string | null;
  busy_until: string | null;
};

export type Boundary =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

export type Region = {
  region_id: string;
  name: string;
  boundary: Boundary | null;
  pool_labor: number;
  pool_materials: number;
  crews: Crew[];
  tasks: Task[];
  stats: {
    total_roads: number;
    healthy_roads: number;
    degraded_roads: number;
    rust_avg: number;
    health_avg: number;
  };
};

export type Hex = {
  h3_index: string;
  rust_level: number;
};

export type FeedItem = {
  event_type: string;
  region_id: string | null;
  message: string;
  ts: string;
};

export type AuthState = {
  clientId: string;
  token: string;
};

type State = {
  region: Region;
  features: Feature[];
  hexes: Hex[];
  cycle: CycleState;
  isDemoMode: boolean;
  availableRegions: { region_id: string; name: string }[];
  auth: AuthState;
  feedItems: FeedItem[];
};

type Actions = {
  setRegion: (region: Region | ((prev: Region) => Region)) => void;
  setFeatures: (features: Feature[] | ((prev: Feature[]) => Feature[])) => void;
  setHexes: (hexes: Hex[]) => void;
  setCycle: (cycle: CycleState) => void;
  setAuth: (auth: AuthState) => void;
  addFeedItem: (item: FeedItem) => void;
};

export const useStore = create<State & Actions>((set) => ({
  // Initial dummy state (will be hydrated)
  region: {
    region_id: "",
    name: "",
    boundary: null,
    pool_labor: 0,
    pool_materials: 0,
    crews: [],
    tasks: [],
    stats: {
      total_roads: 0,
      healthy_roads: 0,
      degraded_roads: 0,
      rust_avg: 0,
      health_avg: 0
    }
  },
  features: [],
  hexes: [],
  cycle: {
    phase: "day",
    phase_progress: 0,
    next_phase: "dusk",
    next_phase_in_seconds: 0
  },
  isDemoMode: false,
  availableRegions: [],
  auth: { clientId: "", token: "" },
  feedItems: [],

  setRegion: (updater) =>
    set((state) => ({
      region: typeof updater === "function" ? updater(state.region) : updater
    })),
  setFeatures: (updater) =>
    set((state) => ({
      features: typeof updater === "function" ? updater(state.features) : updater
    })),
  setHexes: (hexes) => set({ hexes }),
  setCycle: (cycle) => set({ cycle }),
  setAuth: (auth) => set({ auth }),
  addFeedItem: (item) =>
    set((state) => ({
      feedItems: [item, ...state.feedItems].slice(0, 50)
    }))
}));
