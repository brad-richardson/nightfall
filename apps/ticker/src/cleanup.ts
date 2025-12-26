import type { PoolLike } from "./ticker";

export type CleanupStats = {
  eventsDeleted: number;
  transfersDeleted: number;
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

  return {
    eventsDeleted: eventsResult.rowCount ?? 0,
    transfersDeleted: transfersResult.rowCount ?? 0
  };
}
