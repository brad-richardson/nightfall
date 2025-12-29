import type { FeatureDelta } from "./deltas";
import type { PoolLike } from "./ticker";
import type { PhaseMultipliers } from "./multipliers";
import { ROAD_CLASSES, DEGRADED_HEALTH_THRESHOLD, HEALTH_BUCKET_SIZE } from "@nightfall/config";

export async function applyRoadDecay(pool: PoolLike, multipliers: PhaseMultipliers) {
  const decayCases = Object.entries(ROAD_CLASSES)
    .map(([cls, info]) => `WHEN '${cls}' THEN ${info.decayRate}`)
    .join("\n            ");

  // Query uses CTEs to:
  // 1. Capture old state before update
  // 2. Perform the update
  // 3. Filter results to only emit when crossing notable thresholds
  // Region difficulty_multiplier affects decay rate (higher = faster decay)
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
    ),
    old_state AS (
      SELECT fs.gers_id, fs.health, fs.status
      FROM feature_state fs
      JOIN world_features wf ON wf.gers_id = fs.gers_id
      WHERE wf.feature_type = 'road' AND fs.status != 'repairing'
    ),
    decay AS (
      SELECT
        wf.gers_id,
        wf.region_id,
        (
          CASE wf.road_class
            ${decayCases}
            ELSE 1.0
          END
        )
        -- Scale decay by rust level: almost zero when rust is low, full when rust is high
        -- This allows crews to catch up when the city is doing well
        * GREATEST(0.1, COALESCE(feature_rust.rust_level, 0))
        * $1 * COALESCE(r.difficulty_multiplier, 1.0) AS decay_value
      FROM world_features AS wf
      LEFT JOIN feature_rust ON feature_rust.gers_id = wf.gers_id
      LEFT JOIN regions AS r ON r.region_id = wf.region_id
      WHERE wf.feature_type = 'road'
    ),
    updated AS (
      UPDATE feature_state AS fs
      SET
        health = GREATEST(0, fs.health - decay.decay_value),
        status = CASE
          WHEN GREATEST(0, fs.health - decay.decay_value) < ${DEGRADED_HEALTH_THRESHOLD} THEN 'degraded'
          ELSE 'normal'
        END,
        updated_at = now()
      FROM decay
      WHERE fs.gers_id = decay.gers_id
        AND fs.status != 'repairing'
      RETURNING fs.gers_id, decay.region_id, fs.health, fs.status
    )
    SELECT u.gers_id, u.region_id, u.health, u.status
    FROM updated u
    JOIN old_state o ON o.gers_id = u.gers_id
    WHERE
      -- Status changed (normal <-> degraded)
      o.status != u.status
      OR
      -- Health crossed a bucket boundary (e.g., 81->79 crosses 80)
      floor(o.health / ${HEALTH_BUCKET_SIZE}) != floor(u.health / ${HEALTH_BUCKET_SIZE})
      OR
      -- Health reached zero (critical state, even if still in bucket 0)
      (u.health = 0 AND o.health > 0)
    `,
    [multipliers.decay]
  );

  return result.rows;
}

