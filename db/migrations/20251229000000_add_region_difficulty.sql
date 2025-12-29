-- migrate:up

-- Add difficulty_multiplier column to regions table
-- Default is 1.0 (normal difficulty). Higher values = harder (faster decay)
ALTER TABLE regions ADD COLUMN IF NOT EXISTS difficulty_multiplier REAL NOT NULL DEFAULT 1.0;

-- Update crew_count to match hex count (1 worker per hex)
-- This ensures regions have appropriate crew capacity based on their size
UPDATE regions r
SET crew_count = COALESCE(
  (SELECT COUNT(*)::SMALLINT FROM hex_cells h WHERE h.region_id = r.region_id),
  1
);

-- migrate:down

ALTER TABLE regions DROP COLUMN IF EXISTS difficulty_multiplier;
