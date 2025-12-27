import type { FeatureDelta, FeedItem, TaskDelta } from "./deltas";
import type { PoolLike } from "./ticker";
import type { PhaseMultipliers } from "./multipliers";
import { DEGRADED_HEALTH_THRESHOLD } from "@nightfall/config";
import {
  type Point,
  findPath,
  findNearestConnector,
  haversineDistanceMeters,
} from "@nightfall/pathfinding";
import { loadGraphForRegion } from "./resources";

const MIN_REPAIR_THRESHOLD = DEGRADED_HEALTH_THRESHOLD;
const CREW_TRAVEL_MPS = 10; // Crew travel speed in meters per second
const CREW_TRAVEL_MIN_S = 4;
const CREW_TRAVEL_MAX_S = 120;

type CompletedTask = TaskDelta & { region_id: string };

type HexUpdate = { h3_index: string; rust_level: number };

type CompletedRow = {
  tasks: CompletedTask[];
  features: FeatureDelta[];
  hexes: HexUpdate[];
};

export type DispatchResult = {
  taskDeltas: TaskDelta[];
  featureDeltas: FeatureDelta[];
  regionIds: string[];
};

export type ArrivalResult = {
  featureDeltas: FeatureDelta[];
  regionIds: string[];
};

export type CompletionResult = {
  taskDeltas: TaskDelta[];
  featureDeltas: FeatureDelta[];
  rustHexes: HexUpdate[];
  regionIds: string[];
  feedItems: FeedItem[];
};

export async function dispatchCrews(pool: PoolLike) {
  const taskDeltas: TaskDelta[] = [];
  const regionIds: string[] = [];

  const idleResult = await pool.query<{ crew_id: string; region_id: string }>(
    "SELECT crew_id, region_id FROM crews WHERE status = 'idle'"
  );

  for (const crew of idleResult.rows) {
    await pool.query("BEGIN");

    try {
      const regionResult = await pool.query<{
        pool_food: number;
        pool_equipment: number;
        pool_energy: number;
        pool_materials: number;
      }>(
        "SELECT pool_food, pool_equipment, pool_energy, pool_materials FROM regions WHERE region_id = $1 FOR UPDATE",
        [crew.region_id]
      );
      const region = regionResult.rows[0];

      if (!region) {
        await pool.query("ROLLBACK");
        continue;
      }

      const poolFood = Number(region.pool_food ?? 0);
      const poolEquipment = Number(region.pool_equipment ?? 0);
      const poolEnergy = Number(region.pool_energy ?? 0);
      const poolMaterials = Number(region.pool_materials ?? 0);

      const taskResult = await pool.query<{
        task_id: string;
        target_gers_id: string;
        cost_food: number;
        cost_equipment: number;
        cost_energy: number;
        cost_materials: number;
        duration_s: number;
      }>(
        `
        SELECT
          task_id,
          target_gers_id,
          cost_food,
          cost_equipment,
          cost_energy,
          cost_materials,
          duration_s
        FROM tasks
        WHERE region_id = $1
          AND status = 'queued'
          AND cost_food <= $2
          AND cost_equipment <= $3
          AND cost_energy <= $4
          AND cost_materials <= $5
        ORDER BY priority_score DESC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
        `,
        [crew.region_id, poolFood, poolEquipment, poolEnergy, poolMaterials]
      );

      const task = taskResult.rows[0];
      if (!task) {
        await pool.query("ROLLBACK");
        continue;
      }

      // Query hub and road coordinates for pathfinding
      const coordsResult = await pool.query<{
        hub_lon: number;
        hub_lat: number;
        road_lon: number;
        road_lat: number;
      }>(
        `
        SELECT
          (hub.bbox_xmin + hub.bbox_xmax) / 2 AS hub_lon,
          (hub.bbox_ymin + hub.bbox_ymax) / 2 AS hub_lat,
          (road.bbox_xmin + road.bbox_xmax) / 2 AS road_lon,
          (road.bbox_ymin + road.bbox_ymax) / 2 AS road_lat
        FROM hex_cells h
        JOIN world_features hub ON hub.gers_id = h.hub_building_gers_id
        JOIN world_features road ON road.gers_id = $1
        JOIN world_feature_hex_cells wfhc ON wfhc.gers_id = $1
        WHERE h.h3_index = wfhc.h3_index
        LIMIT 1
        `,
        [task.target_gers_id]
      );

      // Calculate travel time using pathfinding or fallback to haversine
      let travelTimeS = CREW_TRAVEL_MIN_S;
      const coords = coordsResult.rows[0];

      if (coords) {
        const graphData = await loadGraphForRegion(pool, crew.region_id);
        if (graphData) {
          const hubPoint: Point = [coords.hub_lon, coords.hub_lat];
          const roadPoint: Point = [coords.road_lon, coords.road_lat];

          const startConnector = findNearestConnector(graphData.coords, hubPoint);
          const endConnector = findNearestConnector(graphData.coords, roadPoint);

          if (startConnector && endConnector) {
            const pathResult = findPath(
              graphData.graph,
              graphData.coords,
              startConnector,
              endConnector
            );
            if (pathResult) {
              travelTimeS = pathResult.totalDistance / CREW_TRAVEL_MPS;
            } else {
              // No path found, fallback to haversine
              travelTimeS = haversineDistanceMeters(hubPoint, roadPoint) / CREW_TRAVEL_MPS;
            }
          } else {
            // No connectors found, fallback to haversine
            travelTimeS = haversineDistanceMeters(hubPoint, roadPoint) / CREW_TRAVEL_MPS;
          }
        } else {
          // No graph data, fallback to haversine
          const hubPoint: Point = [coords.hub_lon, coords.hub_lat];
          const roadPoint: Point = [coords.road_lon, coords.road_lat];
          travelTimeS = haversineDistanceMeters(hubPoint, roadPoint) / CREW_TRAVEL_MPS;
        }
      }

      // Clamp travel time to min/max bounds
      travelTimeS = Math.max(CREW_TRAVEL_MIN_S, Math.min(CREW_TRAVEL_MAX_S, travelTimeS));

      await pool.query(
        `UPDATE regions SET
          pool_food = pool_food - $2,
          pool_equipment = pool_equipment - $3,
          pool_energy = pool_energy - $4,
          pool_materials = pool_materials - $5,
          updated_at = now()
        WHERE region_id = $1`,
        [crew.region_id, task.cost_food, task.cost_equipment, task.cost_energy, task.cost_materials]
      );

      const taskUpdate = await pool.query<TaskDelta>(
        `
        UPDATE tasks
        SET status = 'active'
        WHERE task_id = $1
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
        `,
        [task.task_id]
      );

      // Set crew to 'traveling' - road status will be updated when crew arrives
      await pool.query(
        "UPDATE crews SET status = 'traveling', active_task_id = $2, busy_until = now() + ($3 * interval '1 second') WHERE crew_id = $1",
        [crew.crew_id, task.task_id, travelTimeS]
      );

      await pool.query("COMMIT");

      const taskDelta = taskUpdate.rows[0];
      if (taskDelta) {
        taskDeltas.push(taskDelta);
      }

      regionIds.push(crew.region_id);
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }

  // featureDeltas are now empty since roads are updated when crews arrive
  return { taskDeltas, featureDeltas: [], regionIds } satisfies DispatchResult;
}

/**
 * Transition crews that have finished traveling to 'working' status.
 * Also sets the road to 'repairing' and starts the repair timer.
 */
export async function arriveCrews(
  pool: PoolLike,
  multipliers: PhaseMultipliers
): Promise<ArrivalResult> {
  const featureDeltas: FeatureDelta[] = [];
  const regionIds: string[] = [];

  // Find crews that have finished traveling
  const travelingResult = await pool.query<{
    crew_id: string;
    region_id: string;
    active_task_id: string;
    duration_s: number;
    target_gers_id: string;
  }>(
    `
    SELECT
      c.crew_id,
      c.region_id,
      c.active_task_id,
      t.duration_s,
      t.target_gers_id
    FROM crews AS c
    JOIN tasks AS t ON t.task_id = c.active_task_id
    WHERE c.status = 'traveling'
      AND c.busy_until <= now()
    FOR UPDATE SKIP LOCKED
    `
  );

  for (const crew of travelingResult.rows) {
    await pool.query("BEGIN");

    try {
      const repairDurationS = Math.max(
        1,
        Math.ceil(crew.duration_s / multipliers.repair_speed)
      );

      // Update crew to 'working' with repair duration
      await pool.query(
        "UPDATE crews SET status = 'working', busy_until = now() + ($2 * interval '1 second') WHERE crew_id = $1",
        [crew.crew_id, repairDurationS]
      );

      // Set road to 'repairing'
      const featureUpdate = await pool.query<FeatureDelta>(
        `
        UPDATE feature_state AS fs
        SET status = 'repairing', updated_at = now()
        FROM world_features AS wf
        WHERE fs.gers_id = wf.gers_id
          AND fs.gers_id = $1
        RETURNING fs.gers_id, wf.region_id, fs.health, fs.status
        `,
        [crew.target_gers_id]
      );

      await pool.query("COMMIT");

      const featureDelta = featureUpdate.rows[0];
      if (featureDelta) {
        featureDeltas.push(featureDelta);
      }

      regionIds.push(crew.region_id);
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }

  return { featureDeltas, regionIds };
}

export async function completeFinishedTasks(
  pool: PoolLike,
  multipliers: PhaseMultipliers
): Promise<CompletionResult> {
  const pushback = 0.02 * Math.max(0, 1.5 - multipliers.rust_spread);

  const result = await pool.query<CompletedRow>(
    `
    WITH due AS (
      SELECT
        c.crew_id,
        c.active_task_id,
        t.target_gers_id,
        t.repair_amount,
        t.region_id
      FROM crews AS c
      JOIN tasks AS t ON t.task_id = c.active_task_id
      WHERE c.status = 'working'
        AND c.busy_until <= now()
      FOR UPDATE SKIP LOCKED
    ),
    due_hexes AS (
      SELECT DISTINCT wfhc.h3_index
      FROM due
      JOIN world_feature_hex_cells AS wfhc ON wfhc.gers_id = due.target_gers_id
    ),
    updated_tasks AS (
      UPDATE tasks AS t
      SET status = 'done', completed_at = now()
      FROM due
      WHERE t.task_id = due.active_task_id
      RETURNING
        t.task_id,
        t.status,
        t.priority_score,
        t.region_id,
        t.target_gers_id,
        t.vote_score,
        t.cost_food,
        t.cost_equipment,
        t.cost_energy,
        t.cost_materials,
        t.duration_s,
        t.repair_amount,
        t.task_type
    ),
    updated_features AS (
      UPDATE feature_state AS fs
      SET
        health = 100,  -- Always heal to full health
        status = 'normal',  -- Always becomes normal since health = 100
        updated_at = now()
      FROM due
      WHERE fs.gers_id = due.target_gers_id
      RETURNING fs.gers_id, due.region_id, fs.health, fs.status
    ),
    updated_crews AS (
      UPDATE crews AS c
      SET status = 'idle', active_task_id = NULL, busy_until = NULL
      FROM due
      WHERE c.crew_id = due.crew_id
      RETURNING c.crew_id
    ),
    updated_hex AS (
      UPDATE hex_cells AS h
      SET
        rust_level = GREATEST(0, h.rust_level - $1),
        updated_at = now()
      FROM due_hexes AS d
      WHERE h.h3_index = d.h3_index
      RETURNING h.h3_index, h.rust_level
    )
    SELECT
      COALESCE(
        jsonb_agg(DISTINCT jsonb_build_object(
          'task_id', updated_tasks.task_id,
          'status', updated_tasks.status,
          'priority_score', updated_tasks.priority_score,
          'region_id', updated_tasks.region_id,
          'target_gers_id', updated_tasks.target_gers_id,
          'vote_score', updated_tasks.vote_score,
          'cost_food', updated_tasks.cost_food,
          'cost_equipment', updated_tasks.cost_equipment,
          'cost_energy', updated_tasks.cost_energy,
          'cost_materials', updated_tasks.cost_materials,
          'duration_s', updated_tasks.duration_s,
          'repair_amount', updated_tasks.repair_amount,
          'task_type', updated_tasks.task_type
        )) FILTER (WHERE updated_tasks.task_id IS NOT NULL),
        '[]'::jsonb
      ) AS tasks,
      COALESCE(
        jsonb_agg(DISTINCT jsonb_build_object(
          'gers_id', updated_features.gers_id,
          'region_id', updated_features.region_id,
          'health', updated_features.health,
          'status', updated_features.status
        )) FILTER (WHERE updated_features.gers_id IS NOT NULL),
        '[]'::jsonb
      ) AS features,
      COALESCE(
        jsonb_agg(DISTINCT jsonb_build_object(
          'h3_index', updated_hex.h3_index,
          'rust_level', updated_hex.rust_level
        )) FILTER (WHERE updated_hex.h3_index IS NOT NULL),
        '[]'::jsonb
      ) AS hexes
    FROM updated_tasks
    FULL JOIN updated_features ON TRUE
    FULL JOIN updated_hex ON TRUE
    `,
    [pushback]
  );

  const row = result.rows[0];
  const completedTasks = (row?.tasks ?? []) as CompletedTask[];
  const taskDeltas = completedTasks;
  const featureDeltas = (row?.features ?? []) as FeatureDelta[];
  const rustHexes = (row?.hexes ?? []) as HexUpdate[];
  const regionIds = completedTasks.map((task) => task.region_id);

  for (const task of completedTasks) {
    await pool.query(
      "INSERT INTO events (event_type, region_id, payload) VALUES ('task_complete', $1, $2::jsonb)",
      [task.region_id, JSON.stringify({ task_id: task.task_id, status: task.status })]
    );
  }

  const now = new Date().toISOString();
  const feedItems: FeedItem[] = completedTasks.map((task) => ({
    event_type: "task_complete",
    region_id: task.region_id,
    message: "Task completed",
    ts: now
  }));

  return {
    taskDeltas,
    featureDeltas,
    rustHexes,
    regionIds,
    feedItems
  };
}
