-- migrate:up
CREATE TABLE game_events (
  seq_id BIGSERIAL PRIMARY KEY,
  channel TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for replay queries: find events after a given seq_id for specific channels
CREATE INDEX idx_game_events_seq_channel ON game_events(seq_id, channel);

-- Index for cleanup job: delete events older than 1 hour
CREATE INDEX idx_game_events_created_at ON game_events(created_at);

-- migrate:down
DROP INDEX IF EXISTS idx_game_events_created_at;
DROP INDEX IF EXISTS idx_game_events_seq_channel;
DROP TABLE IF EXISTS game_events;
