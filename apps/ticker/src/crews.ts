import type { PoolLike } from "./ticker";
import type { PhaseMultipliers } from "./multipliers";

const MIN_REPAIR_THRESHOLD = 30;

export async function dispatchCrews(pool: PoolLike, multipliers: PhaseMultipliers) {
  const idleResult = await pool.query<{ crew_id: string; region_id: string }>(
    "SELECT crew_id, region_id FROM crews WHERE status = 'idle'"
  );

  for (const crew of idleResult.rows) {
    await pool.query("BEGIN");

    try {
      const regionResult = await pool.query<{ pool_labor: number; pool_materials: number }>(
        "SELECT pool_labor, pool_materials FROM regions WHERE region_id = $1 FOR UPDATE",
        [crew.region_id]
      );
      const region = regionResult.rows[0];

      if (!region) {
        await pool.query("ROLLBACK");
        continue;
      }

      const poolLabor = Number(region.pool_labor ?? 0);
      const poolMaterials = Number(region.pool_materials ?? 0);

      const taskResult = await pool.query<{
        task_id: string;
        target_gers_id: string;
        cost_labor: number;
        cost_materials: number;
        duration_s: number;
      }>(
        `
        SELECT
          task_id,
          target_gers_id,
          cost_labor,
          cost_materials,
          duration_s
        FROM tasks
        WHERE region_id = $1
          AND status = 'queued'
          AND cost_labor <= $2
          AND cost_materials <= $3
        ORDER BY priority_score DESC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
        `,
        [crew.region_id, poolLabor, poolMaterials]
      );

      const task = taskResult.rows[0];
      if (!task) {
        await pool.query("ROLLBACK");
        continue;
      }

      const durationSeconds = Math.max(
        1,
        Math.ceil(task.duration_s / multipliers.repair_speed)
      );

      await pool.query(
        "UPDATE regions SET pool_labor = pool_labor - $2, pool_materials = pool_materials - $3, updated_at = now() WHERE region_id = $1",
        [crew.region_id, task.cost_labor, task.cost_materials]
      );

      await pool.query("UPDATE tasks SET status = 'active' WHERE task_id = $1", [
        task.task_id
      ]);

      await pool.query(
        "UPDATE feature_state SET status = 'repairing', updated_at = now() WHERE gers_id = $1",
        [task.target_gers_id]
      );

      await pool.query(
        "UPDATE crews SET status = 'working', active_task_id = $2, busy_until = now() + ($3 * interval '1 second') WHERE crew_id = $1",
        [crew.crew_id, task.task_id, durationSeconds]
      );

      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }
}

export async function completeFinishedTasks(pool: PoolLike, multipliers: PhaseMultipliers) {
  const pushback = 0.02 * Math.max(0, 1.5 - multipliers.rust_spread);

  await pool.query(
    `
    WITH due AS (
      SELECT
        c.crew_id,
        c.active_task_id,
        t.target_gers_id,
        t.repair_amount,
        wf.h3_index
      FROM crews AS c
      JOIN tasks AS t ON t.task_id = c.active_task_id
      JOIN world_features AS wf ON wf.gers_id = t.target_gers_id
      WHERE c.status = 'working'
        AND c.busy_until <= now()
      FOR UPDATE SKIP LOCKED
    ),
    updated_tasks AS (
      UPDATE tasks AS t
      SET status = 'done', completed_at = now()
      FROM due
      WHERE t.task_id = due.active_task_id
      RETURNING t.task_id
    ),
    updated_features AS (
      UPDATE feature_state AS fs
      SET
        health = LEAST(100, fs.health + due.repair_amount),
        status = CASE
          WHEN LEAST(100, fs.health + due.repair_amount) >= $2 THEN 'normal'
          ELSE 'degraded'
        END,
        updated_at = now()
      FROM due
      WHERE fs.gers_id = due.target_gers_id
      RETURNING due.h3_index
    ),
    updated_crews AS (
      UPDATE crews AS c
      SET status = 'idle', active_task_id = NULL, busy_until = NULL
      FROM due
      WHERE c.crew_id = due.crew_id
      RETURNING c.crew_id
    )
    UPDATE hex_cells AS h
    SET
      rust_level = GREATEST(0, h.rust_level - $1),
      updated_at = now()
    FROM (SELECT DISTINCT h3_index FROM due) AS d
    WHERE h.h3_index = d.h3_index
    `,
    [pushback, MIN_REPAIR_THRESHOLD]
  );
}
