export type FeatureDelta = {
  gers_id: string;
  region_id: string;
  health: number;
  status: string;
};

export type TaskDelta = {
  task_id: string;
  status: string;
  priority_score: number;
  vote_score: number;
  cost_labor: number;
  cost_materials: number;
  duration_s: number;
  repair_amount: number;
  task_type: string;
  target_gers_id: string;
  region_id: string;
};

export type FeedItem = {
  event_type: string;
  region_id: string | null;
  message: string;
  ts: string;
};
