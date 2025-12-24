import type { PoolLike } from "./ticker";

const DEFAULT_LAMBDA = 0.1;

export async function spawnDegradedRoadTasks(pool: PoolLike) {
  await pool.query(
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
        WHEN 'motorway' THEN 100
        WHEN 'trunk' THEN 80
        WHEN 'primary' THEN 60
        WHEN 'secondary' THEN 40
        WHEN 'tertiary' THEN 30
        WHEN 'residential' THEN 20
        WHEN 'service' THEN 10
        ELSE 20
      END AS cost_labor,
      CASE wf.road_class
        WHEN 'motorway' THEN 100
        WHEN 'trunk' THEN 80
        WHEN 'primary' THEN 60
        WHEN 'secondary' THEN 40
        WHEN 'tertiary' THEN 30
        WHEN 'residential' THEN 20
        WHEN 'service' THEN 10
        ELSE 20
      END AS cost_materials,
      CASE wf.road_class
        WHEN 'motorway' THEN 120
        WHEN 'trunk' THEN 100
        WHEN 'primary' THEN 80
        WHEN 'secondary' THEN 60
        WHEN 'tertiary' THEN 50
        WHEN 'residential' THEN 40
        WHEN 'service' THEN 30
        ELSE 40
      END AS duration_s,
      CASE wf.road_class
        WHEN 'motorway' THEN 30
        WHEN 'trunk' THEN 30
        WHEN 'primary' THEN 25
        WHEN 'secondary' THEN 25
        WHEN 'tertiary' THEN 20
        WHEN 'residential' THEN 20
        WHEN 'service' THEN 15
        ELSE 20
      END AS repair_amount,
      0,
      0,
      'queued'
    FROM world_features AS wf
    JOIN feature_state AS fs ON fs.gers_id = wf.gers_id
    WHERE wf.feature_type = 'road'
      AND fs.status = 'degraded'
      AND NOT EXISTS (
        SELECT 1
        FROM tasks AS t
        WHERE t.target_gers_id = wf.gers_id
          AND t.status IN ('queued', 'active')
      )
    `
  );
}

export async function updateTaskPriorities(pool: PoolLike, lambda = DEFAULT_LAMBDA) {
  await pool.query(
    `
    WITH vote_scores AS (
      SELECT
        task_id,
        SUM(weight * EXP(-$1 * EXTRACT(EPOCH FROM (now() - created_at)) / 3600.0)) AS vote_score
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
          WHEN 'motorway' THEN 10
          WHEN 'trunk' THEN 8
          WHEN 'primary' THEN 6
          WHEN 'secondary' THEN 4
          WHEN 'tertiary' THEN 3
          WHEN 'residential' THEN 2
          WHEN 'service' THEN 1
          ELSE 1
        END
      ) + task_info.vote_score
    FROM task_info
    WHERE t.task_id = task_info.task_id
    `,
    [lambda]
  );
}
