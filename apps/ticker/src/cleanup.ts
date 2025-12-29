import type { PoolLike } from "./ticker";

export type CleanupStats = {
  eventsDeleted: number;
  transfersDeleted: number;
  orphanedTasksReset: number;
};

const CLEANUP_RETENTION_DAYS = Math.max(1, Number(process.env.CLEANUP_RETENTION_DAYS ?? 14) || 14);
const CLEANUP_TRANSFER_RETENTION_DAYS = Math.max(
  1,
  Number(process.env.CLEANUP_TRANSFER_RETENTION_DAYS ?? CLEANUP_RETENTION_DAYS) || CLEANUP_RETENTION_DAYS
);

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

  return {
    eventsDeleted: eventsResult.rowCount ?? 0,
    transfersDeleted: transfersResult.rowCount ?? 0,
    orphanedTasksReset: orphanedTasksResult.rowCount ?? 0
  };
}
