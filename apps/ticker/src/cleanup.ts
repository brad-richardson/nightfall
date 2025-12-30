import type { PoolLike } from "./ticker";

export type CleanupStats = {
  eventsDeleted: number;
  transfersDeleted: number;
  orphanedTasksReset: number;
  gameEventsDeleted: number;
};

const CLEANUP_RETENTION_DAYS = Math.max(1, Number(process.env.CLEANUP_RETENTION_DAYS ?? 14) || 14);
const CLEANUP_TRANSFER_RETENTION_DAYS = Math.max(
  1,
  Number(process.env.CLEANUP_TRANSFER_RETENTION_DAYS ?? CLEANUP_RETENTION_DAYS) || CLEANUP_RETENTION_DAYS
);
// Game events (SSE replay buffer) are cleaned up after 1 hour
const GAME_EVENTS_RETENTION_HOURS = Math.max(1, Number(process.env.GAME_EVENTS_RETENTION_HOURS ?? 1) || 1);

export async function cleanupOldData(pool: PoolLike): Promise<CleanupStats> {
  const eventsResult = await pool.query(
    "DELETE FROM events WHERE ts < now() - make_interval(days => $1::int)",
    [CLEANUP_RETENTION_DAYS]
  );

  const transfersResult = await pool.query(
    "DELETE FROM resource_transfers WHERE arrive_at < now() - make_interval(days => $1::int)",
    [CLEANUP_TRANSFER_RETENTION_DAYS]
  );

  // Reset orphaned 'active' tasks back to 'queued'
  // These are tasks that have status='active' but no crew is working on them
  const orphanedTasksResult = await pool.query(
    `UPDATE tasks
     SET status = 'queued'
     WHERE status = 'active'
       AND task_id NOT IN (SELECT active_task_id FROM crews WHERE active_task_id IS NOT NULL)`
  );

  // Clean up old game events (SSE replay buffer)
  // These are only needed for client reconnection replay (typically < 1 minute)
  // but we keep 1 hour for safety
  const gameEventsResult = await pool.query(
    "DELETE FROM game_events WHERE created_at < now() - make_interval(hours => $1::int)",
    [GAME_EVENTS_RETENTION_HOURS]
  );

  return {
    eventsDeleted: eventsResult.rowCount ?? 0,
    transfersDeleted: transfersResult.rowCount ?? 0,
    orphanedTasksReset: orphanedTasksResult.rowCount ?? 0,
    gameEventsDeleted: gameEventsResult.rowCount ?? 0
  };
}
