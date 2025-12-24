export type FeatureDelta = {
  gers_id: string;
  health: number;
  status: string;
};

export type TaskDelta = {
  task_id: string;
  status: string;
  priority_score: number;
};

export type FeedItem = {
  event_type: string;
  region_id: string | null;
  message: string;
  ts: string;
};
