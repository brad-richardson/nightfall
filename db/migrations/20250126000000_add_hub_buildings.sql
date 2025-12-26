-- migrate:up
ALTER TABLE hex_cells ADD COLUMN hub_building_gers_id TEXT REFERENCES world_features(gers_id);
CREATE INDEX IF NOT EXISTS hex_cells_hub_building_idx ON hex_cells(hub_building_gers_id);

-- Also add is_hub flag to world_features for easier querying
ALTER TABLE world_features ADD COLUMN is_hub BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS world_features_is_hub_idx ON world_features(is_hub) WHERE is_hub = TRUE;

-- migrate:down
DROP INDEX IF EXISTS world_features_is_hub_idx;
ALTER TABLE world_features DROP COLUMN IF EXISTS is_hub;
DROP INDEX IF EXISTS hex_cells_hub_building_idx;
ALTER TABLE hex_cells DROP COLUMN IF EXISTS hub_building_gers_id;
