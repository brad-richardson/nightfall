-- migrate:up
-- Add partial unique index to prevent duplicate queued/active tasks for same target
-- This prevents race conditions in spawnDegradedRoadTasks when multiple ticker instances run
CREATE UNIQUE INDEX IF NOT EXISTS tasks_target_active_unique
ON tasks (target_gers_id)
WHERE status IN ('queued', 'active');

-- migrate:down
DROP INDEX IF EXISTS tasks_target_active_unique;
