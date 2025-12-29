-- migrate:up
ALTER TABLE world_features ADD COLUMN backbone_tier SMALLINT;

-- Index for efficient backbone queries (only roads with backbone_tier set)
CREATE INDEX IF NOT EXISTS world_features_backbone_idx ON world_features(backbone_tier) WHERE backbone_tier IS NOT NULL;

-- migrate:down
DROP INDEX IF EXISTS world_features_backbone_idx;
ALTER TABLE world_features DROP COLUMN IF EXISTS backbone_tier;
