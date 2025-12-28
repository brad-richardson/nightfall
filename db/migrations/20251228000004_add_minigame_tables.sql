-- Migration: Add minigame tables for production boosts
-- Up migration

-- Track active production boosts (one per building at a time)
CREATE TABLE production_boosts (
  boost_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_gers_id TEXT NOT NULL REFERENCES world_features(gers_id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  multiplier REAL NOT NULL DEFAULT 2.0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  minigame_type TEXT NOT NULL,
  score INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id UUID NOT NULL,
  CONSTRAINT one_active_boost_per_building UNIQUE (building_gers_id)
);

CREATE INDEX production_boosts_building_expires_idx
  ON production_boosts(building_gers_id, expires_at);
CREATE INDEX production_boosts_expires_idx
  ON production_boosts(expires_at) WHERE expires_at > now();

-- Track cooldowns per player per building
CREATE TABLE minigame_cooldowns (
  client_id TEXT NOT NULL,
  building_gers_id TEXT NOT NULL REFERENCES world_features(gers_id) ON DELETE CASCADE,
  available_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (client_id, building_gers_id)
);

CREATE INDEX minigame_cooldowns_available_idx
  ON minigame_cooldowns(client_id, available_at);

-- Server-side minigame sessions for anti-cheat validation
CREATE TABLE minigame_sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL,
  building_gers_id TEXT NOT NULL REFERENCES world_features(gers_id) ON DELETE CASCADE,
  minigame_type TEXT NOT NULL,
  difficulty JSONB NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  max_possible_score INT NOT NULL,
  expected_duration_ms INT NOT NULL,
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE INDEX minigame_sessions_client_idx ON minigame_sessions(client_id, status);

---- Down migration
-- DROP TABLE IF EXISTS minigame_sessions;
-- DROP TABLE IF EXISTS minigame_cooldowns;
-- DROP TABLE IF EXISTS production_boosts;
