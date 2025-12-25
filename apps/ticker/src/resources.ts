import type { PoolLike } from "./ticker";
import type { PhaseMultipliers } from "./multipliers";

export async function generateRegionResources(pool: PoolLike, multipliers: PhaseMultipliers) {
  const result = await pool.query<{ region_id: string }>(
    `
    WITH feature_rust AS (
      SELECT
        wf.gers_id,
        wf.region_id,
        wf.generates_labor,
        wf.generates_materials,
        AVG(h.rust_level) AS rust_level
      FROM world_features AS wf
      JOIN world_feature_hex_cells AS wfhc ON wfhc.gers_id = wf.gers_id
      JOIN hex_cells AS h ON h.h3_index = wfhc.h3_index
      WHERE wf.feature_type = 'building'
      GROUP BY wf.gers_id, wf.region_id, wf.generates_labor, wf.generates_materials
    ),
    totals AS (
      SELECT
        feature_rust.region_id,
        SUM(
          CASE
            WHEN feature_rust.generates_labor THEN (1 - feature_rust.rust_level) * $1
            ELSE 0
          END
        ) AS labor,
        SUM(
          CASE
            WHEN feature_rust.generates_materials THEN (1 - feature_rust.rust_level) * $1
            ELSE 0
          END
        ) AS materials
      FROM feature_rust
      GROUP BY feature_rust.region_id
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
