import type { PoolLike } from "./ticker";
import type { PhaseMultipliers } from "./multipliers";

export async function applyRoadDecay(pool: PoolLike, multipliers: PhaseMultipliers) {
  await pool.query(
    `
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
        ) * (1 + h.rust_level) * $1 AS decay_value
      FROM world_features AS wf
      JOIN hex_cells AS h ON h.h3_index = wf.h3_index
      WHERE wf.feature_type = 'road'
    ) AS decay
    WHERE fs.gers_id = decay.gers_id
    `,
    [multipliers.decay]
  );
}
