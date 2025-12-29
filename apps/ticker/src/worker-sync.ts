import type { PoolLike } from "./ticker";
import { logger } from "./logger";

type SyncResult = { added: number; removed: number };

/**
 * Syncs the number of crews per region to match the hex cell count.
 * Goal: 1 worker per hex cell (minimum 1 per region).
 *
 * - Adds new idle crews if hex count exceeds crew count
 * - Removes idle crews if crew count exceeds hex count (never removes active crews)
 * - Updates the crew_count column on the regions table
 * - Assigns crews to specific hex hubs (home_hub_gers_id) for distributed returning
 *
 * All operations are performed in a single transaction for consistency.
 */
export async function syncRegionWorkers(pool: PoolLike): Promise<SyncResult> {
  // Use a single query with CTEs to handle everything atomically
  // This avoids N+1 queries and ensures transaction safety
  const result = await pool.query<SyncResult>(`
    WITH region_stats AS (
      -- Calculate target crew count for each region (1 per hex, minimum 1)
      SELECT
        r.region_id,
        GREATEST(1, COALESCE(h.hex_count, 1))::int AS target_crews,
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
    ),
    -- Get hex cells with their hubs for crew assignment
    hex_hubs AS (
      SELECT h.region_id, h.h3_index, h.hub_building_gers_id,
             ROW_NUMBER() OVER (PARTITION BY h.region_id ORDER BY h.h3_index) AS hex_idx
      FROM hex_cells h
      WHERE h.hub_building_gers_id IS NOT NULL
    ),
    regions_needing_crews AS (
      -- Regions that need more crews
      SELECT region_id, (target_crews - current_crews) AS crews_to_add
      FROM region_stats
      WHERE target_crews > current_crews
    ),
    crews_to_remove AS (
      -- Select idle crews to remove (excess crews, only idle ones)
      SELECT c.crew_id, c.region_id
      FROM crews c
      JOIN region_stats rs ON rs.region_id = c.region_id
      WHERE rs.current_crews > rs.target_crews
        AND c.status = 'idle'
        AND c.crew_id IN (
          SELECT crew_id FROM crews c2
          WHERE c2.region_id = c.region_id AND c2.status = 'idle'
          ORDER BY c2.crew_id
          LIMIT GREATEST(0, rs.current_crews - rs.target_crews)
        )
    ),
    inserted_crews AS (
      -- Add new crews where needed, assigning to hex hubs in round-robin
      INSERT INTO crews (region_id, status, home_hub_gers_id)
      SELECT
        r.region_id,
        'idle',
        -- Assign crews to hubs in round-robin (1 per hex)
        (SELECT hub_building_gers_id FROM hex_hubs hh
         WHERE hh.region_id = r.region_id
         ORDER BY hh.hex_idx
         OFFSET (gs.n - 1) % (SELECT COUNT(*) FROM hex_hubs hh2 WHERE hh2.region_id = r.region_id)
         LIMIT 1)
      FROM regions_needing_crews r
      CROSS JOIN LATERAL generate_series(1, r.crews_to_add) AS gs(n)
      RETURNING crew_id
    ),
    deleted_crews AS (
      -- Remove excess idle crews
      DELETE FROM crews
      WHERE crew_id IN (SELECT crew_id FROM crews_to_remove)
      RETURNING crew_id
    ),
    updated_regions AS (
      -- Update crew_count only for regions where it changed
      UPDATE regions r
      SET crew_count = rs.target_crews
      FROM region_stats rs
      WHERE r.region_id = rs.region_id
        AND r.crew_count != rs.target_crews
      RETURNING r.region_id
    )
    SELECT
      (SELECT COUNT(*)::int FROM inserted_crews) AS added,
      (SELECT COUNT(*)::int FROM deleted_crews) AS removed
  `);

  const { added, removed } = result.rows[0] ?? { added: 0, removed: 0 };

  if (added > 0 || removed > 0) {
    logger.info({ added, removed }, "worker sync complete");
  }

  return { added, removed };
}
