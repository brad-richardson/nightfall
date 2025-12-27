-- migrate:up

-- Add position tracking columns to crews table
ALTER TABLE crews ADD COLUMN IF NOT EXISTS current_lng DOUBLE PRECISION;
ALTER TABLE crews ADD COLUMN IF NOT EXISTS current_lat DOUBLE PRECISION;
ALTER TABLE crews ADD COLUMN IF NOT EXISTS waypoints JSONB;
ALTER TABLE crews ADD COLUMN IF NOT EXISTS path_started_at TIMESTAMPTZ;
ALTER TABLE crews ADD COLUMN IF NOT EXISTS home_hub_gers_id TEXT REFERENCES world_features(gers_id);

-- Add 2 more crews per region (we have 1, want 2-3)
INSERT INTO crews (region_id, status)
SELECT region_id, 'idle' FROM regions
UNION ALL
SELECT region_id, 'idle' FROM regions;

-- migrate:down

-- Remove added crews (keep original one per region)
DELETE FROM crews WHERE crew_id IN (
  SELECT crew_id FROM (
    SELECT crew_id, ROW_NUMBER() OVER (PARTITION BY region_id ORDER BY crew_id) as rn
    FROM crews
  ) ranked WHERE rn > 1
);

ALTER TABLE crews DROP COLUMN IF EXISTS home_hub_gers_id;
ALTER TABLE crews DROP COLUMN IF EXISTS path_started_at;
ALTER TABLE crews DROP COLUMN IF EXISTS waypoints;
ALTER TABLE crews DROP COLUMN IF EXISTS current_lat;
ALTER TABLE crews DROP COLUMN IF EXISTS current_lng;
