-- migrate:up
CREATE TABLE IF NOT EXISTS resource_transfers (
  transfer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id TEXT NOT NULL REFERENCES regions(region_id),
  source_gers_id TEXT REFERENCES world_features(gers_id),
  hub_gers_id TEXT REFERENCES world_features(gers_id),
  resource_type TEXT NOT NULL,
  amount INT NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'in_transit',
  depart_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  arrive_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS resource_transfers_region_status_idx
  ON resource_transfers(region_id, status, arrive_at);
CREATE INDEX IF NOT EXISTS resource_transfers_arrive_idx
  ON resource_transfers(arrive_at) WHERE status = 'in_transit';

-- migrate:down
DROP INDEX IF EXISTS resource_transfers_arrive_idx;
DROP INDEX IF EXISTS resource_transfers_region_status_idx;
DROP TABLE IF EXISTS resource_transfers;
