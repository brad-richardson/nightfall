import type { PoolLike } from "./ticker";
import type { PhaseMultipliers } from "./multipliers";

export async function generateRegionResources(pool: PoolLike, multipliers: PhaseMultipliers) {
  const result = await pool.query<{ region_id: string }>(
    `
    WITH totals AS (
      SELECT
        wf.region_id,
        SUM(
          CASE
            WHEN wf.generates_labor THEN (1 - h.rust_level) * $1
            ELSE 0
          END
        ) AS labor,
        SUM(
          CASE
            WHEN wf.generates_materials THEN (1 - h.rust_level) * $1
            ELSE 0
          END
        ) AS materials
      FROM world_features AS wf
      JOIN hex_cells AS h ON h.h3_index = wf.h3_index
      WHERE wf.feature_type = 'building'
      GROUP BY wf.region_id
    )
    UPDATE regions AS r
    SET
      pool_labor = r.pool_labor + COALESCE(totals.labor, 0),
      pool_materials = r.pool_materials + COALESCE(totals.materials, 0),
      updated_at = now()
    FROM totals
    WHERE r.region_id = totals.region_id
    RETURNING r.region_id
    `,
    [multipliers.generation]
  );

  return result.rows.map((row) => row.region_id);
}
