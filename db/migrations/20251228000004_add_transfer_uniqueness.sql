-- migrate:up
-- Prevent multiple in_transit transfers from the same source building
CREATE UNIQUE INDEX IF NOT EXISTS idx_resource_transfers_one_per_source
ON resource_transfers (source_gers_id)
WHERE status = 'in_transit';

-- migrate:down
DROP INDEX IF EXISTS idx_resource_transfers_one_per_source;
