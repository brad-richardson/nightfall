import type { Phase } from "../../store";

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

export type Crew = {
  crew_id: string;
  status: string;
  active_task_id: string | null;
  busy_until?: string | null;
  current_lng?: number | null;
  current_lat?: number | null;
  waypoints?: PathWaypoint[] | null;
  path_started_at?: string | null;
};

export type Task = {
  task_id: string;
  target_gers_id: string;
  status?: string;
  cost_food?: number;
  cost_equipment?: number;
  cost_energy?: number;
  cost_materials?: number;
};

export type Hex = {
  h3_index: string;
  rust_level: number;
};

export type CrewPath = {
  crew_id: string;
  task_id: string;
  path: [number, number][];
  startTime: number;
  endTime: number;
  status: "traveling" | "working";
  waypoints?: PathWaypoint[] | null;
};

export type PathWaypoint = {
  coord: [number, number];
  arrive_at: string;
};

export type ResourceTransferPayload = {
  transfer_id: string;
  region_id: string;
  source_gers_id: string | null;
  hub_gers_id: string | null;
  resource_type: "food" | "equipment" | "energy" | "materials";
  amount: number;
  depart_at: string;
  arrive_at: string;
  path_waypoints?: PathWaypoint[] | null;
  boost_multiplier?: number | null; // If source building has active boost
};

export type Boundary =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

export type Bbox = {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
};

export type DemoMapProps = {
  boundary: Boundary | null;
  features: Feature[];
  hexes: Hex[];
  crews: Crew[];
  tasks: Task[];
  fallbackBbox: Bbox;
  focusH3Index?: string | null;
  cycle: {
    phase: Phase;
    phase_progress: number;
    next_phase: Phase;
  };
  pmtilesRelease: string | null;
  children?: React.ReactNode;
  className?: string;
};
