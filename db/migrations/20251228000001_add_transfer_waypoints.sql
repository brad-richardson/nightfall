-- migrate:up

-- Add path waypoints to resource_transfers for road-based animation
-- Each waypoint has coordinates and arrival timestamp for visible slowdowns on degraded roads
ALTER TABLE resource_transfers
  ADD COLUMN path_waypoints JSONB;

-- Format: [{"coord": [lng, lat], "arrive_at": "ISO timestamp"}, ...]
-- Gap between timestamps reflects road health - larger gaps = slower (degraded road)
COMMENT ON COLUMN resource_transfers.path_waypoints IS
  'Array of waypoints with coordinates and arrival timestamps for road-following animation with visible slowdowns';

-- migrate:down

ALTER TABLE resource_transfers DROP COLUMN IF EXISTS path_waypoints;
