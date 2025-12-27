import type { FeatureDelta } from "./deltas";
import type { PoolLike } from "./ticker";
import type { PhaseMultipliers } from "./multipliers";
import { ROAD_CLASSES } from "@nightfall/config";

export async function applyRoadDecay(pool: PoolLike, multipliers: PhaseMultipliers) {
  const decayCases = Object.entries(ROAD_CLASSES)
    .map(([cls, info]) => `WHEN '${cls}' THEN ${info.decayRate}`)
    .join("\n            ");

  const result = await pool.query<FeatureDelta>(
    `
    WITH feature_rust AS (
      SELECT
        wf.gers_id,
        AVG(h.rust_level) AS rust_level
      FROM world_features AS wf
      JOIN world_feature_hex_cells AS wfhc ON wfhc.gers_id = wf.gers_id
      JOIN hex_cells AS h ON h.h3_index = wfhc.h3_index
      WHERE wf.feature_type = 'road'
      GROUP BY wf.gers_id
    )
    UPDATE feature_state AS fs
    SET
      health = GREATEST(0, fs.health - decay.decay_value),
      status = CASE
        WHEN GREATEST(0, fs.health - decay.decay_value) < 30 THEN 'degraded'
        ELSE 'normal'
      END,
      updated_at = now()
    FROM (
      SELECT
        wf.gers_id,
        wf.region_id,
        (
          CASE wf.road_class
            ${decayCases}
            ELSE 1.0
          END
        ) * (1 + COALESCE(feature_rust.rust_level, 0)) * $1 AS decay_value
      FROM world_features AS wf
      LEFT JOIN feature_rust ON feature_rust.gers_id = wf.gers_id
      WHERE wf.feature_type = 'road'
    ) AS decay
    WHERE fs.gers_id = decay.gers_id
      AND fs.status != 'repairing'
    RETURNING fs.gers_id, decay.region_id, fs.health, fs.status
    `,
    [multipliers.decay]
  );

  return result.rows;
}

