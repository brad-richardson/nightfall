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
  generates_labor?: boolean;
  generates_materials?: boolean;
  is_hub?: boolean;
};

export type Crew = {
  crew_id: string;
  status: string;
  active_task_id: string | null;
  busy_until?: string | null;
};

export type Task = {
  task_id: string;
  target_gers_id: string;
  status?: string;
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
};

export type ResourceTransferPayload = {
  transfer_id: string;
  region_id: string;
  source_gers_id: string | null;
  hub_gers_id: string | null;
  resource_type: "labor" | "materials";
  amount: number;
  depart_at: string;
  arrive_at: string;
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
  cycle: {
    phase: Phase;
    phase_progress: number;
    next_phase: Phase;
  };
  pmtilesRelease: string;
  children?: React.ReactNode;
  className?: string;
};
