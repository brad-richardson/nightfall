import type { FeatureDelta } from "./deltas";
import type { PoolLike } from "./ticker";
import type { PhaseMultipliers } from "./multipliers";

export async function applyRoadDecay(pool: PoolLike, multipliers: PhaseMultipliers) {
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
        (
          CASE wf.road_class
            WHEN 'motorway' THEN 0.5
            WHEN 'trunk' THEN 0.6
            WHEN 'primary' THEN 0.8
            WHEN 'secondary' THEN 1.0
            WHEN 'tertiary' THEN 1.2
            WHEN 'residential' THEN 1.5
            WHEN 'service' THEN 2.0
            ELSE 1.0
          END
        ) * (1 + COALESCE(feature_rust.rust_level, 0)) * $1 AS decay_value
      FROM world_features AS wf
      LEFT JOIN feature_rust ON feature_rust.gers_id = wf.gers_id
      WHERE wf.feature_type = 'road'
    ) AS decay
    WHERE fs.gers_id = decay.gers_id
    RETURNING fs.gers_id, fs.health, fs.status
    `,
    [multipliers.decay]
  );

  return result.rows;
}
