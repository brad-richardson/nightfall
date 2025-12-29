import type { TaskDelta } from "./deltas";
import type { PoolLike } from "./ticker";
import {
  ROAD_CLASSES,
  DEGRADED_HEALTH_THRESHOLD,
  RESOURCE_TYPES,
  type ResourceType,
} from "@nightfall/config";

/**
 * Generate SQL CASE expression for hash-based cost calculation.
 * Cost = baseCost + offset, where offset is in [-costVariance, +costVariance]
 * The offset is determined by hashing (gers_id || resourceType) for consistency.
 *
 * @param resourceType - Must be a valid ResourceType from config
 * @throws Error if resourceType is not in RESOURCE_TYPES (defense against SQL injection)
 */
export function buildCostCase(resourceType: ResourceType): string {
  // Validate resourceType against allowed values to prevent SQL injection
  if (!RESOURCE_TYPES.includes(resourceType)) {
    throw new Error(
      `Invalid resourceType: ${resourceType}. Must be one of: ${RESOURCE_TYPES.join(", ")}`
    );
  }

  const cases = Object.entries(ROAD_CLASSES)
    .map(([cls, info]) => {
      const range = 2 * info.costVariance + 1;
      // Use hashtext for deterministic hash, abs + mod to get offset in [0, range-1], then subtract variance
      return `WHEN '${cls}' THEN ${info.baseCost} + (abs(hashtext(wf.gers_id || '${resourceType}')) % ${range}) - ${info.costVariance}`;
    })
    .join("\n        ");
  return cases;
}

export async function spawnDegradedRoadTasks(pool: PoolLike) {
  const costFoodCases = buildCostCase("food");
  const costEquipmentCases = buildCostCase("equipment");
  const costEnergyCases = buildCostCase("energy");
  const costMaterialsCases = buildCostCase("materials");

  const durationCases = Object.entries(ROAD_CLASSES)
    .map(([cls, info]) => `WHEN '${cls}' THEN ${info.durationS}`)
    .join("\n        ");

  const repairCases = Object.entries(ROAD_CLASSES)
    .map(([cls, info]) => `WHEN '${cls}' THEN ${info.repairAmount}`)
    .join("\n        ");

  const priorityWeightCases = Object.entries(ROAD_CLASSES)
    .map(([cls, info]) => `WHEN '${cls}' THEN ${info.priorityWeight}`)
    .join("\n        ");

  const result = await pool.query<TaskDelta>(
    `
    INSERT INTO tasks (
      region_id,
      target_gers_id,
      task_type,
      cost_food,
      cost_equipment,
      cost_energy,
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
        ${costFoodCases}
        ELSE 10
      END AS cost_food,
      CASE wf.road_class
        ${costEquipmentCases}
        ELSE 15
      END AS cost_equipment,
      CASE wf.road_class
        ${costEnergyCases}
        ELSE 12
      END AS cost_energy,
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
      -- Calculate initial priority based on road health and class weight
      (100 - fs.health) * (
        CASE wf.road_class
          ${priorityWeightCases}
          ELSE 1
        END
      ),
      0,
      'queued'
    FROM world_features AS wf
    JOIN feature_state AS fs ON fs.gers_id = wf.gers_id
    WHERE wf.feature_type = 'road'
      AND fs.health < ${DEGRADED_HEALTH_THRESHOLD}
      AND fs.status != 'repairing'
    ON CONFLICT (target_gers_id) WHERE status IN ('queued', 'active') DO NOTHING
    RETURNING
      task_id,
      status,
      priority_score,
      vote_score,
      cost_food,
      cost_equipment,
      cost_energy,
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

/**
 * Update task priorities based on road health and class.
 * Priority is for display purposes only - task selection is distance-based.
 */
export async function updateTaskPriorities(pool: PoolLike) {
  const weightCases = Object.entries(ROAD_CLASSES)
    .map(([cls, info]) => `WHEN '${cls}' THEN ${info.priorityWeight}`)
    .join("\n          ");

  const result = await pool.query<TaskDelta>(
    `
    WITH task_info AS (
      SELECT
        t.task_id,
        fs.health,
        wf.road_class
      FROM tasks AS t
      JOIN world_features AS wf ON wf.gers_id = t.target_gers_id
      JOIN feature_state AS fs ON fs.gers_id = t.target_gers_id
      WHERE t.status IN ('queued', 'active')
    )
    UPDATE tasks AS t
    SET
      priority_score = (100 - task_info.health) * (
        CASE task_info.road_class
          ${weightCases}
          ELSE 1
        END
      )
    FROM task_info
    WHERE t.task_id = task_info.task_id
    RETURNING
      t.task_id,
      t.status,
      t.priority_score,
      t.vote_score,
      t.cost_food,
      t.cost_equipment,
      t.cost_energy,
      t.cost_materials,
      t.duration_s,
      t.repair_amount,
      t.task_type,
      t.target_gers_id,
      t.region_id
    `
  );

  return result.rows;
}
