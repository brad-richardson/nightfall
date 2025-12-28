import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Phase = "dawn" | "day" | "dusk" | "night";

export type CycleState = {
  phase: Phase;
  phase_progress: number;
  next_phase: Phase;
  next_phase_in_seconds: number;
  lastUpdated?: number; // Timestamp to force re-renders
};

export type Feature = {
  gers_id: string;
  feature_type: string;
  h3_index?: string | null;
  bbox: [number, number, number, number] | null;
  geometry?: {
    type: "Point" | "LineString" | "MultiLineString" | "Polygon" | "MultiPolygon";
    coordinates: number[] | number[][] | number[][][] | number[][][][] | number[][][][];
  } | null;
  health?: number | null;
  status?: string | null;
  road_class?: string | null;
  place_category?: string | null;
  generates_food?: boolean;
  generates_equipment?: boolean;
  generates_energy?: boolean;
  generates_materials?: boolean;
  is_hub?: boolean;
};

export type Task = {
  task_id: string;
  target_gers_id: string;
  priority_score: number;
  status: string;
  vote_score: number;
  cost_food: number;
  cost_equipment: number;
  cost_energy: number;
  cost_materials: number;
  duration_s: number;
  repair_amount: number;
  task_type: string;
  region_id?: string;
};

export type PathWaypoint = {
  coord: [number, number];
  arrive_at: string;
};

export type Crew = {
  crew_id: string;
  status: string;
  active_task_id: string | null;
  busy_until: string | null;
  current_lng?: number | null;
  current_lat?: number | null;
  waypoints?: PathWaypoint[] | null;
  path_started_at?: string | null;
};

export type Boundary =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

export type Region = {
  region_id: string;
  name: string;
  boundary: Boundary | null;
  pool_food: number;
  pool_equipment: number;
  pool_energy: number;
  pool_materials: number;
  focus_h3_index?: string | null;
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

// Track user's votes: taskId -> weight (1 or -1)
export type UserVotes = Record<string, number>;

type State = {
  region: Region;
  features: Feature[];
  hexes: Hex[];
  cycle: CycleState;
  isDemoMode: boolean;
  availableRegions: { region_id: string; name: string }[];
  auth: AuthState;
  feedItems: FeedItem[];
  userVotes: UserVotes;
};

type Actions = {
  setRegion: (region: Region | ((prev: Region) => Region)) => void;
  setFeatures: (features: Feature[] | ((prev: Feature[]) => Feature[])) => void;
  setHexes: (hexes: Hex[] | ((prev: Hex[]) => Hex[])) => void;
  setCycle: (cycle: CycleState | ((prev: CycleState) => CycleState)) => void;
  setAuth: (auth: AuthState) => void;
  addFeedItem: (item: FeedItem) => void;
  setUserVote: (taskId: string, weight: number) => void;
  clearUserVote: (taskId: string) => void;
};

export const useStore = create<State & Actions>()(
  persist(
    (set) => ({
      // Initial dummy state (will be hydrated)
      region: {
        region_id: "",
        name: "",
        boundary: null,
        pool_food: 0,
        pool_equipment: 0,
        pool_energy: 0,
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
        next_phase_in_seconds: 0,
        lastUpdated: Date.now()
      },
      isDemoMode: false,
      availableRegions: [],
      auth: { clientId: "", token: "" },
      feedItems: [],
      userVotes: {},

      setRegion: (updater) =>
        set((state) => ({
          region: typeof updater === "function" ? updater(state.region) : updater
        })),
      setFeatures: (updater) =>
        set((state) => ({
          features: typeof updater === "function" ? updater(state.features) : updater
        })),
      setHexes: (updater) =>
        set((state) => ({
          hexes: typeof updater === "function" ? updater(state.hexes) : updater
        })),
      setCycle: (updater) =>
        set((state) => ({
          cycle: typeof updater === "function" ? updater(state.cycle) : updater
        })),
      setAuth: (auth) => set({ auth }),
      addFeedItem: (item) =>
        set((state) => ({
          feedItems: [item, ...state.feedItems].slice(0, 50)
        })),
      setUserVote: (taskId, weight) =>
        set((state) => ({
          userVotes: { ...state.userVotes, [taskId]: weight }
        })),
      clearUserVote: (taskId) =>
        set((state) => {
          const { [taskId]: _removed, ...rest } = state.userVotes;
          void _removed; // Silence unused variable warning
          return { userVotes: rest };
        })
    }),
    {
      name: "nightfall-auth",
      partialize: (state) => ({ auth: state.auth })
    }
  )
);
