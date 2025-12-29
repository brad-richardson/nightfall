-- migrate:up
ALTER TABLE world_features ADD COLUMN length_meters REAL;

-- Create index for potential queries by length
CREATE INDEX IF NOT EXISTS world_features_length_idx ON world_features(length_meters) WHERE feature_type = 'road';

-- migrate:down
DROP INDEX IF EXISTS world_features_length_idx;
ALTER TABLE world_features DROP COLUMN IF EXISTS length_meters;
