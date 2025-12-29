-- migrate:up

-- Server-side repair minigame sessions for anti-cheat validation
CREATE TABLE repair_minigame_sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL,
  road_gers_id TEXT NOT NULL REFERENCES world_features(gers_id) ON DELETE CASCADE,
  minigame_type TEXT NOT NULL,
  difficulty JSONB NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  max_possible_score INT NOT NULL,
  expected_duration_ms INT NOT NULL,
  current_health SMALLINT NOT NULL,
  completed_at TIMESTAMPTZ,
  final_score INT,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE INDEX repair_minigame_sessions_client_idx ON repair_minigame_sessions(client_id, status);
CREATE INDEX repair_minigame_sessions_road_idx ON repair_minigame_sessions(road_gers_id, status);

-- migrate:down
DROP TABLE IF EXISTS repair_minigame_sessions;
