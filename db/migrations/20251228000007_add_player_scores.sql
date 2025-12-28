-- migrate:up

-- Track player scores for leaderboard and tier system
CREATE TABLE player_scores (
  client_id TEXT PRIMARY KEY REFERENCES players(client_id) ON DELETE CASCADE,
  total_score BIGINT NOT NULL DEFAULT 0,
  contribution_score BIGINT NOT NULL DEFAULT 0,
  vote_score BIGINT NOT NULL DEFAULT 0,
  minigame_score BIGINT NOT NULL DEFAULT 0,
  task_completion_bonus BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX player_scores_total_idx ON player_scores(total_score DESC);

-- Track individual score events for audit/analytics
CREATE TABLE score_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL REFERENCES players(client_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- 'contribution', 'vote', 'minigame', 'task_completion'
  amount BIGINT NOT NULL,
  region_id TEXT REFERENCES regions(region_id),
  related_id TEXT, -- task_id, minigame_session_id, etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX score_events_client_idx ON score_events(client_id, created_at DESC);
CREATE INDEX score_events_type_idx ON score_events(event_type, created_at DESC);

-- migrate:down
DROP TABLE IF EXISTS score_events;
DROP TABLE IF EXISTS player_scores;
