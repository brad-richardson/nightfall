import type { PoolLike } from "./ticker";
import { logger } from "./logger";

/**
 * Syncs the number of crews per region to match the hex cell count.
 * Goal: 1 worker per hex cell.
 *
 * - Adds new idle crews if hex count exceeds crew count
 * - Removes idle crews if crew count exceeds hex count (never removes active crews)
 * - Updates the crew_count column on the regions table
 */
export async function syncRegionWorkers(pool: PoolLike): Promise<{ added: number; removed: number }> {
  let totalAdded = 0;
  let totalRemoved = 0;

  // Get regions with their hex count and current crew count
  const regionsResult = await pool.query<{
    region_id: string;
    hex_count: number;
    current_crews: number;
    idle_crews: number;
  }>(`
    SELECT
      r.region_id,
      COALESCE(h.hex_count, 0)::int AS hex_count,
      COALESCE(c.crew_count, 0)::int AS current_crews,
      COALESCE(c.idle_count, 0)::int AS idle_crews
    FROM regions r
    LEFT JOIN (
      SELECT region_id, COUNT(*) AS hex_count
      FROM hex_cells
      GROUP BY region_id
    ) h ON h.region_id = r.region_id
    LEFT JOIN (
      SELECT region_id,
             COUNT(*) AS crew_count,
             COUNT(*) FILTER (WHERE status = 'idle') AS idle_count
      FROM crews
      GROUP BY region_id
    ) c ON c.region_id = r.region_id
  `);

  for (const region of regionsResult.rows) {
    const targetCrews = Math.max(1, region.hex_count); // At least 1 crew per region
    const diff = targetCrews - region.current_crews;

    if (diff > 0) {
      // Need to add crews
      await pool.query(
        `INSERT INTO crews (region_id, status)
         SELECT $1, 'idle'
         FROM generate_series(1, $2)`,
        [region.region_id, diff]
      );
      totalAdded += diff;
    } else if (diff < 0) {
      // Need to remove crews - only remove idle ones
      const toRemove = Math.min(-diff, region.idle_crews);
      if (toRemove > 0) {
        await pool.query(
          `DELETE FROM crews
           WHERE crew_id IN (
             SELECT crew_id FROM crews
             WHERE region_id = $1 AND status = 'idle'
             LIMIT $2
           )`,
          [region.region_id, toRemove]
        );
        totalRemoved += toRemove;
      }
    }

    // Update the crew_count column on the region
    await pool.query(
      `UPDATE regions SET crew_count = $2 WHERE region_id = $1`,
      [region.region_id, targetCrews]
    );
  }

  if (totalAdded > 0 || totalRemoved > 0) {
    logger.info({ added: totalAdded, removed: totalRemoved }, "worker sync complete");
  }

  return { added: totalAdded, removed: totalRemoved };
}
