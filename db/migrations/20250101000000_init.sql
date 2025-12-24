-- migrate:up
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS regions (
  region_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  boundary GEOMETRY(Polygon, 4326) NOT NULL,
  center GEOMETRY(Point, 4326) NOT NULL,
  distance_from_center REAL NOT NULL,
  pool_labor BIGINT NOT NULL DEFAULT 0,
  pool_materials BIGINT NOT NULL DEFAULT 0,
  crew_count SMALLINT NOT NULL DEFAULT 2,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS regions_boundary_idx ON regions USING GIST(boundary);

CREATE TABLE IF NOT EXISTS hex_cells (
  h3_index TEXT PRIMARY KEY,
  region_id TEXT NOT NULL REFERENCES regions(region_id),
  rust_level REAL NOT NULL DEFAULT 0,
  distance_from_center REAL NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hex_cells_region_idx ON hex_cells(region_id);
CREATE INDEX IF NOT EXISTS hex_cells_rust_idx ON hex_cells(rust_level);
CREATE INDEX IF NOT EXISTS hex_cells_distance_idx ON hex_cells(distance_from_center DESC);

CREATE TABLE IF NOT EXISTS world_features (
  gers_id TEXT PRIMARY KEY,
  feature_type TEXT NOT NULL,
  region_id TEXT NOT NULL REFERENCES regions(region_id),
  h3_index TEXT NOT NULL REFERENCES hex_cells(h3_index),
  geom GEOMETRY NOT NULL,
  properties JSONB NOT NULL DEFAULT '{}',
  road_class TEXT,
  place_category TEXT,
  generates_labor BOOLEAN NOT NULL DEFAULT FALSE,
  generates_materials BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS world_features_region_idx ON world_features(region_id);
CREATE INDEX IF NOT EXISTS world_features_h3_idx ON world_features(h3_index);
CREATE INDEX IF NOT EXISTS world_features_type_idx ON world_features(feature_type);
CREATE INDEX IF NOT EXISTS world_features_geom_idx ON world_features USING GIST(geom);

CREATE TABLE IF NOT EXISTS feature_state (
  gers_id TEXT PRIMARY KEY REFERENCES world_features(gers_id),
  health SMALLINT NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'normal',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feature_state_health_idx ON feature_state(health);
CREATE INDEX IF NOT EXISTS feature_state_status_idx ON feature_state(status);

CREATE TABLE IF NOT EXISTS tasks (
  task_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id TEXT NOT NULL REFERENCES regions(region_id),
  target_gers_id TEXT NOT NULL REFERENCES world_features(gers_id),
  task_type TEXT NOT NULL,
  cost_labor INT NOT NULL,
  cost_materials INT NOT NULL,
  duration_s INT NOT NULL,
  repair_amount INT NOT NULL,
  priority_score REAL NOT NULL DEFAULT 0,
  vote_score REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS tasks_region_status_idx ON tasks(region_id, status);
CREATE INDEX IF NOT EXISTS tasks_priority_idx ON tasks(priority_score DESC);
CREATE INDEX IF NOT EXISTS tasks_region_priority_idx ON tasks(region_id, priority_score DESC) WHERE status = 'queued';

CREATE TABLE IF NOT EXISTS task_votes (
  vote_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  weight SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS task_votes_unique_idx ON task_votes(task_id, client_id);
CREATE INDEX IF NOT EXISTS task_votes_task_idx ON task_votes(task_id);

CREATE TABLE IF NOT EXISTS crews (
  crew_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id TEXT NOT NULL REFERENCES regions(region_id),
  status TEXT NOT NULL DEFAULT 'idle',
  active_task_id UUID REFERENCES tasks(task_id),
  busy_until TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS crews_region_idx ON crews(region_id);
CREATE INDEX IF NOT EXISTS crews_status_idx ON crews(status);
CREATE INDEX IF NOT EXISTS crews_busy_until_idx ON crews(busy_until) WHERE status = 'working';

CREATE TABLE IF NOT EXISTS players (
  client_id TEXT PRIMARY KEY,
  display_name TEXT,
  home_region_id TEXT REFERENCES regions(region_id),
  lifetime_contrib BIGINT NOT NULL DEFAULT 0,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_id TEXT,
  region_id TEXT,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS events_ts_idx ON events(ts DESC);
CREATE INDEX IF NOT EXISTS events_region_idx ON events(region_id);

CREATE TABLE IF NOT EXISTS world_meta (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO world_meta (key, value)
VALUES
  ('last_reset', jsonb_build_object('ts', now(), 'version', 1)),
  ('demo_mode', jsonb_build_object('enabled', false, 'tick_multiplier', 1)),
  ('cycle_state', jsonb_build_object('phase', 'day', 'phase_start', now(), 'cycle_start', now()))
ON CONFLICT (key) DO NOTHING;

-- migrate:down
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS players;
DROP TABLE IF EXISTS crews;
DROP TABLE IF EXISTS task_votes;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS feature_state;
DROP TABLE IF EXISTS world_features;
DROP TABLE IF EXISTS hex_cells;
DROP TABLE IF EXISTS regions;
DROP TABLE IF EXISTS world_meta;

DROP EXTENSION IF EXISTS postgis;
DROP EXTENSION IF EXISTS pgcrypto;
