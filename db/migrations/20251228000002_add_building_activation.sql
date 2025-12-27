-- migrate:up
-- Add last_activated_at column to track when buildings were last interacted with
-- Buildings only generate resources for a limited time after activation

ALTER TABLE feature_state ADD COLUMN IF NOT EXISTS last_activated_at TIMESTAMPTZ;

-- Index for efficient filtering of recently activated buildings
CREATE INDEX IF NOT EXISTS idx_feature_state_last_activated_at
ON feature_state(last_activated_at)
WHERE last_activated_at IS NOT NULL;

-- migrate:down
DROP INDEX IF EXISTS idx_feature_state_last_activated_at;
ALTER TABLE feature_state DROP COLUMN IF EXISTS last_activated_at;
