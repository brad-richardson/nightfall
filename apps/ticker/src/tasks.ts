import type { TaskDelta } from "./deltas";
import type { PoolLike } from "./ticker";
import { ROAD_CLASSES } from "@nightfall/config";

const DEFAULT_LAMBDA = 0.1;

export async function spawnDegradedRoadTasks(pool: PoolLike) {
  const costLaborCases = Object.entries(ROAD_CLASSES)
    .map(([cls, info]) => `WHEN '${cls}' THEN ${info.costLabor}`)
    .join("\n        ");
  
  const costMaterialsCases = Object.entries(ROAD_CLASSES)
    .map(([cls, info]) => `WHEN '${cls}' THEN ${info.costMaterials}`)
    .join("\n        ");

  const durationCases = Object.entries(ROAD_CLASSES)
    .map(([cls, info]) => `WHEN '${cls}' THEN ${info.durationS}`)
    .join("\n        ");

  const repairCases = Object.entries(ROAD_CLASSES)
    .map(([cls, info]) => `WHEN '${cls}' THEN ${info.repairAmount}`)
    .join("\n        ");

  const result = await pool.query<TaskDelta>(
    `
    INSERT INTO tasks (
      region_id,
      target_gers_id,
      task_type,
      cost_labor,
      cost_materials,
      duration_s,
      repair_amount,
      priority_score,
      vote_score,
      status
    )
    SELECT
      wf.region_id,
      wf.gers_id,
      'repair_road',
      CASE wf.road_class
        ${costLaborCases}
        ELSE 20
      END AS cost_labor,
      CASE wf.road_class
        ${costMaterialsCases}
        ELSE 20
      END AS cost_materials,
      CASE wf.road_class
        ${durationCases}
        ELSE 40
      END AS duration_s,
      CASE wf.road_class
        ${repairCases}
        ELSE 20
      END AS repair_amount,
      0,
      0,
      'queued'
    FROM world_features AS wf
    JOIN feature_state AS fs ON fs.gers_id = wf.gers_id
    WHERE wf.feature_type = 'road'
      AND fs.status = 'degraded'
    ON CONFLICT (target_gers_id) WHERE status IN ('queued', 'active') DO NOTHING
    RETURNING
      task_id,
      status,
      priority_score,
      vote_score,
      cost_labor,
      cost_materials,
      duration_s,
      repair_amount,
      task_type,
      target_gers_id,
      region_id
    `
  );

  return result.rows;
}

export async function updateTaskPriorities(pool: PoolLike, lambda = DEFAULT_LAMBDA) {
  const weightCases = Object.entries(ROAD_CLASSES)
    .map(([cls, info]) => `WHEN '${cls}' THEN ${info.priorityWeight}`)
    .join("\n          ");

  const result = await pool.query<TaskDelta>(
    `
    WITH vote_scores AS (
      SELECT
        task_id,
        SUM(weight * EXP(-$1::float * EXTRACT(EPOCH FROM (now() - created_at::timestamptz)) / 3600.0)) AS vote_score
      FROM task_votes
      GROUP BY task_id
    ),
    task_info AS (
      SELECT
        t.task_id,
        COALESCE(v.vote_score, 0) AS vote_score,
        fs.health,
        wf.road_class
      FROM tasks AS t
      JOIN world_features AS wf ON wf.gers_id = t.target_gers_id
      JOIN feature_state AS fs ON fs.gers_id = t.target_gers_id
      LEFT JOIN vote_scores AS v ON v.task_id = t.task_id
      WHERE t.status IN ('queued', 'active')
    )
    UPDATE tasks AS t
    SET
      vote_score = task_info.vote_score,
      priority_score = (100 - task_info.health) * (
        CASE task_info.road_class
          ${weightCases}
          ELSE 1
        END
      ) + task_info.vote_score
    FROM task_info
    WHERE t.task_id = task_info.task_id
    RETURNING
      t.task_id,
      t.status,
      t.priority_score,
      t.vote_score,
      t.cost_labor,
      t.cost_materials,
      t.duration_s,
      t.repair_amount,
      t.task_type,
      t.target_gers_id,
      t.region_id
    `,
    [lambda]
  );

  return result.rows;
}
