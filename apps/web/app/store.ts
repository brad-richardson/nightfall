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
  last_activated_at?: string | null;
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

export type ResourceTransfer = {
  transfer_id: string;
  source_gers_id: string | null;
  hub_gers_id: string | null;
  resource_type: string;
  amount: number;
  depart_at: string;
  arrive_at: string;
  path_waypoints?: PathWaypoint[] | null;
};

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
  resource_transfers?: ResourceTransfer[];
  stats: {
    total_roads: number;
    healthy_roads: number;
    degraded_roads: number;
    rust_avg: number;
    health_avg: number;
    score: number;
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

// Minigame types
export type MinigameType = "kitchen_rush" | "fresh_check" | "gear_up" | "patch_job" | "power_up" | "crane_drop";
export type RepairMinigameType = "pothole_patrol" | "road_roller" | "traffic_director";
export type ResourceType = "food" | "equipment" | "energy" | "materials";

export type MinigameMode = "quick" | "boost";

export type MinigameDifficulty = {
  speed_mult: number;
  window_mult: number;
  extra_rounds: number;
  rust_level: number;
  phase: Phase;
  mode?: MinigameMode;
};

export type MinigameSession = {
  session_id: string;
  building_gers_id: string;
  building_name: string;
  minigame_type: MinigameType;
  resource_type: ResourceType;
  mode: MinigameMode;
  config: {
    base_rounds: number;
    max_score: number;
    expected_duration_ms: number;
  };
  difficulty: MinigameDifficulty;
  started_at: number;
};

export type MinigameResult = {
  score: number;
  performance: number;
  multiplier: number;
  duration_ms: number;
  expires_at: string;
};

// Repair minigame session (for roads)
export type RepairMinigameSession = {
  session_id: string;
  road_gers_id: string;
  road_class: string;
  minigame_type: RepairMinigameType;
  current_health: number;
  target_health: number;
  config: {
    base_rounds: number;
    max_score: number;
    expected_duration_ms: number;
  };
  difficulty: MinigameDifficulty;
  started_at: number;
};

export type RepairMinigameResult = {
  score: number;
  performance: number;
  success: boolean;
  new_health: number;
  health_restored: number;
};

export type BuildingBoost = {
  building_gers_id: string;
  multiplier: number;
  expires_at: string;
  minigame_type: MinigameType;
};

export type MinigameCooldown = {
  building_gers_id: string;
  available_at: string;
};

export type BuildingActivation = {
  building_gers_id: string;
  activated_at: string;
  expires_at: string;
};

// Player score tracking
// SECURITY NOTE: Scores are currently stored client-side only (localStorage).
// This means scores can be manipulated by users and are not synchronized across devices.
// Tier bonuses should NOT be applied server-side until score tracking is moved to the database.
// See TODO.md for planned server-side score implementation.
export type PlayerScore = {
  totalScore: number;
  contributionScore: number; // Score from resource contributions
  voteScore: number; // Score from voting
  minigameScore: number; // Score from minigames
  lastUpdated: number; // Timestamp
};

export type { PlayerTier } from "@nightfall/config";

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
  // Minigame state
  activeMinigame: MinigameSession | null;
  minigameResult: MinigameResult | null;
  buildingBoosts: Record<string, BuildingBoost>;
  minigameCooldowns: Record<string, MinigameCooldown>;
  // Building activation state
  buildingActivations: Record<string, BuildingActivation>;
  // Repair minigame state
  activeRepairMinigame: RepairMinigameSession | null;
  repairMinigameResult: RepairMinigameResult | null;
  // Player score tracking (persisted)
  playerScore: PlayerScore;
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
  // Minigame actions
  startMinigame: (session: MinigameSession) => void;
  completeMinigame: (result: MinigameResult) => void;
  abandonMinigame: () => void;
  setMinigameResult: (result: MinigameResult | null) => void;
  addBuildingBoost: (boost: BuildingBoost) => void;
  removeBuildingBoost: (buildingGersId: string) => void;
  setCooldown: (cooldown: MinigameCooldown) => void;
  // Building activation actions
  addBuildingActivation: (activation: BuildingActivation) => void;
  removeBuildingActivation: (buildingGersId: string) => void;
  // Repair minigame actions
  startRepairMinigame: (session: RepairMinigameSession) => void;
  completeRepairMinigame: (result: RepairMinigameResult) => void;
  abandonRepairMinigame: () => void;
  setRepairMinigameResult: (result: RepairMinigameResult | null) => void;
  // Score actions
  addContributionScore: (amount: number) => void;
  addVoteScore: (amount: number) => void;
  addMinigameScore: (amount: number) => void;
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
          health_avg: 0,
          score: 0
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
      // Minigame initial state
      activeMinigame: null,
      minigameResult: null,
      buildingBoosts: {},
      minigameCooldowns: {},
      // Building activation initial state
      buildingActivations: {},
      // Repair minigame initial state
      activeRepairMinigame: null,
      repairMinigameResult: null,
      // Player score initial state
      playerScore: {
        totalScore: 0,
        contributionScore: 0,
        voteScore: 0,
        minigameScore: 0,
        lastUpdated: Date.now()
      },

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
        }),
      // Minigame actions
      startMinigame: (session) => set({ activeMinigame: session, minigameResult: null }),
      completeMinigame: (result) => set({ activeMinigame: null, minigameResult: result }),
      abandonMinigame: () => set({ activeMinigame: null, minigameResult: null }),
      setMinigameResult: (result) => set({ minigameResult: result }),
      addBuildingBoost: (boost) =>
        set((state) => ({
          buildingBoosts: { ...state.buildingBoosts, [boost.building_gers_id]: boost }
        })),
      removeBuildingBoost: (buildingGersId) =>
        set((state) => {
          const { [buildingGersId]: _removed, ...rest } = state.buildingBoosts;
          void _removed;
          return { buildingBoosts: rest };
        }),
      setCooldown: (cooldown) =>
        set((state) => ({
          minigameCooldowns: { ...state.minigameCooldowns, [cooldown.building_gers_id]: cooldown }
        })),
      // Building activation actions
      addBuildingActivation: (activation) =>
        set((state) => ({
          buildingActivations: { ...state.buildingActivations, [activation.building_gers_id]: activation }
        })),
      removeBuildingActivation: (buildingGersId) =>
        set((state) => {
          const { [buildingGersId]: _removed, ...rest } = state.buildingActivations;
          void _removed;
          return { buildingActivations: rest };
        }),
      // Repair minigame actions
      startRepairMinigame: (session) => set({ activeRepairMinigame: session, repairMinigameResult: null }),
      completeRepairMinigame: (result) => set({ activeRepairMinigame: null, repairMinigameResult: result }),
      abandonRepairMinigame: () => set({ activeRepairMinigame: null, repairMinigameResult: null }),
      setRepairMinigameResult: (result) => set({ repairMinigameResult: result }),
      // Score actions
      addContributionScore: (amount) =>
        set((state) => ({
          playerScore: {
            ...state.playerScore,
            contributionScore: state.playerScore.contributionScore + amount,
            totalScore: state.playerScore.totalScore + amount,
            lastUpdated: Date.now()
          }
        })),
      addVoteScore: (amount) =>
        set((state) => ({
          playerScore: {
            ...state.playerScore,
            voteScore: state.playerScore.voteScore + amount,
            totalScore: state.playerScore.totalScore + amount,
            lastUpdated: Date.now()
          }
        })),
      addMinigameScore: (amount) =>
        set((state) => ({
          playerScore: {
            ...state.playerScore,
            minigameScore: state.playerScore.minigameScore + amount,
            totalScore: state.playerScore.totalScore + amount,
            lastUpdated: Date.now()
          }
        }))
    }),
    {
      name: "nightfall-auth",
      partialize: (state) => ({ auth: state.auth, playerScore: state.playerScore })
    }
  )
);
