import type { FeatureDelta, FeedItem, TaskDelta } from "./deltas";
import type { PoolLike } from "./ticker";
import type { PhaseMultipliers } from "./multipliers";
import {
  type Point,
  findPath,
  findNearestConnector,
  haversineDistanceMeters,
  buildWaypoints,
} from "@nightfall/pathfinding";
import { loadGraphForRegion } from "./resources";

const CREW_TRAVEL_MPS = 15; // Crew travel speed in meters per second (50% faster)
const CREW_TRAVEL_MIN_S = 5;
// Max crew travel time is 75% of resource max (60s) to ensure crews arrive before convoys
const CREW_TRAVEL_MAX_S = 45;

export type CrewWaypoint = { coord: Point; arrive_at: string };

/**
 * Build simple two-point waypoints for straight-line travel when pathfinding fails.
 */
function buildStraightLineWaypoints(
  start: Point,
  end: Point,
  departAtMs: number,
  travelTimeS: number
): CrewWaypoint[] {
  // Handle invalid travel times (NaN, Infinity) by using minimum travel time
  const safeTravelTimeS = !Number.isFinite(travelTimeS) ? CREW_TRAVEL_MIN_S : travelTimeS;
  return [
    { coord: start, arrive_at: new Date(departAtMs).toISOString() },
    { coord: end, arrive_at: new Date(departAtMs + safeTravelTimeS * 1000).toISOString() }
  ];
}

export type CrewEvent = {
  crew_id: string;
  region_id: string;
  event_type: "crew_dispatched" | "crew_arrived" | "crew_returning" | "crew_idle";
  waypoints?: CrewWaypoint[] | null;
  position?: { lng: number; lat: number } | null;
  task_id?: string | null;
};

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
  crewEvents: CrewEvent[];
};

export type ArrivalResult = {
  featureDeltas: FeatureDelta[];
  regionIds: string[];
  crewEvents: CrewEvent[];
};

export type CompletionResult = {
  taskDeltas: TaskDelta[];
  featureDeltas: FeatureDelta[];
  rustHexes: HexUpdate[];
  regionIds: string[];
  feedItems: FeedItem[];
  crewEvents: CrewEvent[];
};

export async function dispatchCrews(pool: PoolLike): Promise<DispatchResult> {
  const taskDeltas: TaskDelta[] = [];
  const regionIds: string[] = [];
  const crewEvents: CrewEvent[] = [];

  // Get idle crews with their current position (or hub position if not set)
  const idleResult = await pool.query<{
    crew_id: string;
    region_id: string;
    current_lng: number | null;
    current_lat: number | null;
    hub_lon: number | null;
    hub_lat: number | null;
  }>(
    `SELECT
      c.crew_id,
      c.region_id,
      c.current_lng,
      c.current_lat,
      COALESCE(ST_X(ST_PointOnSurface(hub.geom)), (hub.bbox_xmin + hub.bbox_xmax) / 2) AS hub_lon,
      COALESCE(ST_Y(ST_PointOnSurface(hub.geom)), (hub.bbox_ymin + hub.bbox_ymax) / 2) AS hub_lat
    FROM crews c
    LEFT JOIN hex_cells h ON h.region_id = c.region_id AND h.hub_building_gers_id IS NOT NULL
    LEFT JOIN world_features hub ON hub.gers_id = h.hub_building_gers_id
    WHERE c.status = 'idle'`
  );

  for (const crew of idleResult.rows) {
    const savepointName = `dispatch_crew_${crew.crew_id.replace(/-/g, '_')}`;
    await pool.query(`SAVEPOINT ${savepointName}`);

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
        await pool.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
        continue;
      }

      const poolFood = Number(region.pool_food ?? 0);
      const poolEquipment = Number(region.pool_equipment ?? 0);
      const poolEnergy = Number(region.pool_energy ?? 0);
      const poolMaterials = Number(region.pool_materials ?? 0);

      // Get crew's starting position for distance calculation
      const crewLng = crew.current_lng ?? crew.hub_lon;
      const crewLat = crew.current_lat ?? crew.hub_lat;

      if (crewLng == null || crewLat == null) {
        await pool.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
        continue;
      }

      // Select nearest affordable task, prioritizing by:
      // 1. Distance from crew (closest first)
      // 2. Road class importance (motorway > residential)
      // 3. Road damage (lower health = more urgent)
      const taskResult = await pool.query<{
        task_id: string;
        target_gers_id: string;
        cost_food: number;
        cost_equipment: number;
        cost_energy: number;
        cost_materials: number;
        duration_s: number;
        road_lon: number;
        road_lat: number;
      }>(
        `
        SELECT
          t.task_id,
          t.target_gers_id,
          t.cost_food,
          t.cost_equipment,
          t.cost_energy,
          t.cost_materials,
          t.duration_s,
          (wf.bbox_xmin + wf.bbox_xmax) / 2 AS road_lon,
          (wf.bbox_ymin + wf.bbox_ymax) / 2 AS road_lat
        FROM tasks t
        JOIN world_features wf ON wf.gers_id = t.target_gers_id
        LEFT JOIN feature_state fs ON fs.gers_id = t.target_gers_id
        WHERE t.region_id = $1
          AND t.status = 'queued'
          AND t.cost_food <= $2
          AND t.cost_equipment <= $3
          AND t.cost_energy <= $4
          AND t.cost_materials <= $5
        ORDER BY
          -- Distance squared (no need for sqrt since we just need ordering)
          POW((wf.bbox_xmin + wf.bbox_xmax) / 2 - $6, 2) +
          POW((wf.bbox_ymin + wf.bbox_ymax) / 2 - $7, 2) ASC,
          -- Road class priority (higher = more important)
          CASE wf.road_class
            WHEN 'motorway' THEN 10
            WHEN 'trunk' THEN 8
            WHEN 'primary' THEN 6
            WHEN 'secondary' THEN 4
            WHEN 'tertiary' THEN 3
            WHEN 'residential' THEN 2
            WHEN 'service' THEN 1
            ELSE 0
          END DESC,
          -- Most damaged first
          COALESCE(fs.health, 100) ASC
        FOR UPDATE OF t SKIP LOCKED
        LIMIT 1
        `,
        [crew.region_id, poolFood, poolEquipment, poolEnergy, poolMaterials, crewLng, crewLat]
      );

      const task = taskResult.rows[0];
      if (!task) {
        await pool.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
        continue;
      }

      // Road coordinates already fetched in task query
      const road = { road_lon: task.road_lon, road_lat: task.road_lat };

      // Crew starting position already calculated above as crewLng/crewLat
      const startLng = crewLng;
      const startLat = crewLat;

      // Calculate travel time and waypoints using pathfinding
      let travelTimeS = CREW_TRAVEL_MIN_S;
      let waypoints: CrewWaypoint[] | null = null;
      const departAt = Date.now();
      const startPoint: Point = [startLng, startLat];
      const roadPoint: Point = [road.road_lon, road.road_lat];

      const graphData = await loadGraphForRegion(pool, crew.region_id);
      if (graphData) {
        const startConnector = findNearestConnector(graphData.coords, startPoint);
        const endConnector = findNearestConnector(graphData.coords, roadPoint);

        if (startConnector && endConnector) {
          const pathResult = findPath(
            graphData.graph,
            graphData.coords,
            startConnector,
            endConnector
          );
          if (pathResult) {
            // Build waypoints with timestamps, including actual start/end points
            waypoints = buildWaypoints(pathResult, graphData.coords, departAt, CREW_TRAVEL_MPS, {
              actualStart: startPoint,
              actualEnd: roadPoint,
            });
            if (waypoints.length > 1) {
              const lastWaypoint = waypoints[waypoints.length - 1];
              travelTimeS = (Date.parse(lastWaypoint.arrive_at) - departAt) / 1000;
            }
          } else {
            // Pathfinding failed - use straight-line fallback
            travelTimeS = haversineDistanceMeters(startPoint, roadPoint) / CREW_TRAVEL_MPS;
            waypoints = buildStraightLineWaypoints(startPoint, roadPoint, departAt, travelTimeS);
          }
        } else {
          // No connectors found - use straight-line fallback
          travelTimeS = haversineDistanceMeters(startPoint, roadPoint) / CREW_TRAVEL_MPS;
          waypoints = buildStraightLineWaypoints(startPoint, roadPoint, departAt, travelTimeS);
        }
      } else {
        // No graph data - use straight-line fallback
        travelTimeS = haversineDistanceMeters(startPoint, roadPoint) / CREW_TRAVEL_MPS;
        waypoints = buildStraightLineWaypoints(startPoint, roadPoint, departAt, travelTimeS);
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

      // Set crew to 'traveling' with waypoints and path_started_at
      await pool.query(
        `UPDATE crews SET
          status = 'traveling',
          active_task_id = $2,
          busy_until = now() + ($3 * interval '1 second'),
          waypoints = $4,
          path_started_at = now()
        WHERE crew_id = $1`,
        [crew.crew_id, task.task_id, travelTimeS, waypoints ? JSON.stringify(waypoints) : null]
      );

      // Insert crew_dispatched event
      await pool.query(
        "INSERT INTO events (event_type, region_id, payload) VALUES ('crew_dispatched', $1, $2::jsonb)",
        [crew.region_id, JSON.stringify({
          crew_id: crew.crew_id,
          task_id: task.task_id,
          waypoints
        })]
      );

      await pool.query(`RELEASE SAVEPOINT ${savepointName}`);

      const taskDelta = taskUpdate.rows[0];
      if (taskDelta) {
        taskDeltas.push(taskDelta);
      }

      regionIds.push(crew.region_id);
      crewEvents.push({
        crew_id: crew.crew_id,
        region_id: crew.region_id,
        event_type: "crew_dispatched",
        waypoints,
        task_id: task.task_id
      });
    } catch (error) {
      await pool.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
      throw error;
    }
  }

  return { taskDeltas, featureDeltas: [], regionIds, crewEvents };
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
  const crewEvents: CrewEvent[] = [];

  // Find crews that have finished traveling (with a task - going to work)
  const travelingResult = await pool.query<{
    crew_id: string;
    region_id: string;
    active_task_id: string;
    duration_s: number;
    target_gers_id: string;
    waypoints: CrewWaypoint[] | null;
  }>(
    `
    SELECT
      c.crew_id,
      c.region_id,
      c.active_task_id,
      t.duration_s,
      t.target_gers_id,
      c.waypoints
    FROM crews AS c
    JOIN tasks AS t ON t.task_id = c.active_task_id
    WHERE c.status = 'traveling'
      AND c.busy_until <= now()
    FOR UPDATE SKIP LOCKED
    `
  );

  for (const crew of travelingResult.rows) {
    const savepointName = `arrive_crew_${crew.crew_id.replace(/-/g, '_')}`;
    await pool.query(`SAVEPOINT ${savepointName}`);

    try {
      const repairDurationS = Math.max(
        1,
        Math.ceil(crew.duration_s / multipliers.repair_speed)
      );

      // Get final position from waypoints or road center
      let finalLng: number | null = null;
      let finalLat: number | null = null;

      if (crew.waypoints && crew.waypoints.length > 0) {
        const lastWaypoint = crew.waypoints[crew.waypoints.length - 1];
        finalLng = lastWaypoint.coord[0];
        finalLat = lastWaypoint.coord[1];
      } else {
        // Fallback to road center
        const roadResult = await pool.query<{ lon: number; lat: number }>(
          `SELECT (bbox_xmin + bbox_xmax) / 2 AS lon, (bbox_ymin + bbox_ymax) / 2 AS lat
           FROM world_features WHERE gers_id = $1`,
          [crew.target_gers_id]
        );
        if (roadResult.rows[0]) {
          finalLng = roadResult.rows[0].lon;
          finalLat = roadResult.rows[0].lat;
        }
      }

      // Update crew to 'working' with repair duration, snapshot position, clear waypoints
      await pool.query(
        `UPDATE crews SET
          status = 'working',
          busy_until = now() + ($2 * interval '1 second'),
          current_lng = $3,
          current_lat = $4,
          waypoints = NULL,
          path_started_at = NULL
        WHERE crew_id = $1`,
        [crew.crew_id, repairDurationS, finalLng, finalLat]
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

      // Insert crew_arrived event
      await pool.query(
        "INSERT INTO events (event_type, region_id, payload) VALUES ('crew_arrived', $1, $2::jsonb)",
        [crew.region_id, JSON.stringify({
          crew_id: crew.crew_id,
          task_id: crew.active_task_id,
          position: finalLng && finalLat ? { lng: finalLng, lat: finalLat } : null
        })]
      );

      await pool.query(`RELEASE SAVEPOINT ${savepointName}`);

      const featureDelta = featureUpdate.rows[0];
      if (featureDelta) {
        featureDeltas.push(featureDelta);
      }

      regionIds.push(crew.region_id);
      crewEvents.push({
        crew_id: crew.crew_id,
        region_id: crew.region_id,
        event_type: "crew_arrived",
        position: finalLng && finalLat ? { lng: finalLng, lat: finalLat } : null,
        task_id: crew.active_task_id
      });
    } catch (error) {
      await pool.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
      throw error;
    }
  }

  return { featureDeltas, regionIds, crewEvents };
}

/**
 * Handle crews that are returning to hub (traveling without active_task_id).
 */
export async function arriveCrewsAtHub(pool: PoolLike): Promise<CrewEvent[]> {
  const crewEvents: CrewEvent[] = [];

  // Find crews traveling back to hub (no active task)
  const returningResult = await pool.query<{
    crew_id: string;
    region_id: string;
    waypoints: CrewWaypoint[] | null;
    home_hub_gers_id: string | null;
  }>(
    `
    SELECT c.crew_id, c.region_id, c.waypoints, c.home_hub_gers_id
    FROM crews c
    WHERE c.status = 'traveling'
      AND c.active_task_id IS NULL
      AND c.busy_until <= now()
    FOR UPDATE SKIP LOCKED
    `
  );

  for (const crew of returningResult.rows) {
    // Get final position from waypoints
    let finalLng: number | null = null;
    let finalLat: number | null = null;

    if (crew.waypoints && crew.waypoints.length > 0) {
      const lastWaypoint = crew.waypoints[crew.waypoints.length - 1];
      finalLng = lastWaypoint.coord[0];
      finalLat = lastWaypoint.coord[1];
    }

    // Fallback: if no waypoints, lookup hub position (prefer home hub)
    if (finalLng == null || finalLat == null) {
      const hubResult = await pool.query<{ hub_lon: number; hub_lat: number }>(
        `SELECT COALESCE(ST_X(ST_PointOnSurface(hub.geom)), (hub.bbox_xmin + hub.bbox_xmax) / 2) AS hub_lon,
                COALESCE(ST_Y(ST_PointOnSurface(hub.geom)), (hub.bbox_ymin + hub.bbox_ymax) / 2) AS hub_lat
         FROM world_features hub
         WHERE hub.gers_id = COALESCE($2, (
           SELECT h.hub_building_gers_id FROM hex_cells h
           WHERE h.region_id = $1 AND h.hub_building_gers_id IS NOT NULL
           LIMIT 1
         ))`,
        [crew.region_id, crew.home_hub_gers_id]
      );
      if (hubResult.rows[0]) {
        finalLng = hubResult.rows[0].hub_lon;
        finalLat = hubResult.rows[0].hub_lat;
      }
    }

    // Update crew to 'idle' at hub
    await pool.query(
      `UPDATE crews SET
        status = 'idle',
        current_lng = $2,
        current_lat = $3,
        waypoints = NULL,
        path_started_at = NULL,
        busy_until = NULL
      WHERE crew_id = $1`,
      [crew.crew_id, finalLng, finalLat]
    );

    // Insert crew_idle event
    await pool.query(
      "INSERT INTO events (event_type, region_id, payload) VALUES ('crew_idle', $1, $2::jsonb)",
      [crew.region_id, JSON.stringify({
        crew_id: crew.crew_id,
        position: finalLng && finalLat ? { lng: finalLng, lat: finalLat } : null
      })]
    );

    crewEvents.push({
      crew_id: crew.crew_id,
      region_id: crew.region_id,
      event_type: "crew_idle",
      position: finalLng && finalLat ? { lng: finalLng, lat: finalLat } : null
    });
  }

  return crewEvents;
}

export async function completeFinishedTasks(
  pool: PoolLike,
  multipliers: PhaseMultipliers
): Promise<CompletionResult> {
  const pushback = 0.02 * Math.max(0, 1.5 - multipliers.rust_spread);
  const crewEvents: CrewEvent[] = [];

  // First, find crews that are done working
  const dueCrewsResult = await pool.query<{
    crew_id: string;
    region_id: string;
    active_task_id: string;
    target_gers_id: string;
    current_lng: number | null;
    current_lat: number | null;
    home_hub_gers_id: string | null;
  }>(
    `
    SELECT
      c.crew_id,
      c.region_id,
      c.active_task_id,
      t.target_gers_id,
      c.current_lng,
      c.current_lat,
      c.home_hub_gers_id
    FROM crews AS c
    JOIN tasks AS t ON t.task_id = c.active_task_id
    WHERE c.status = 'working'
      AND c.busy_until <= now()
    FOR UPDATE SKIP LOCKED
    `
  );

  if (dueCrewsResult.rows.length === 0) {
    return {
      taskDeltas: [],
      featureDeltas: [],
      rustHexes: [],
      regionIds: [],
      feedItems: [],
      crewEvents: []
    };
  }

  // Complete tasks, update features and hexes
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
        health = 100,
        status = 'normal',
        updated_at = now()
      FROM due
      WHERE fs.gers_id = due.target_gers_id
      RETURNING fs.gers_id, due.region_id, fs.health, fs.status
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

  // Insert task_complete events
  for (const task of completedTasks) {
    await pool.query(
      "INSERT INTO events (event_type, region_id, payload) VALUES ('task_complete', $1, $2::jsonb)",
      [task.region_id, JSON.stringify({ task_id: task.task_id, status: task.status })]
    );
  }

  // Now handle each crew - either dispatch to next task or return to hub
  for (const crew of dueCrewsResult.rows) {
    // Check for next task and resources
    const regionResult = await pool.query<{
      pool_food: number;
      pool_equipment: number;
      pool_energy: number;
      pool_materials: number;
    }>(
      "SELECT pool_food, pool_equipment, pool_energy, pool_materials FROM regions WHERE region_id = $1",
      [crew.region_id]
    );
    const region = regionResult.rows[0];

    if (!region) {
      // No region, just set idle
      await pool.query(
        "UPDATE crews SET status = 'idle', active_task_id = NULL, busy_until = NULL WHERE crew_id = $1",
        [crew.crew_id]
      );
      continue;
    }

    const poolFood = Number(region.pool_food ?? 0);
    const poolEquipment = Number(region.pool_equipment ?? 0);
    const poolEnergy = Number(region.pool_energy ?? 0);
    const poolMaterials = Number(region.pool_materials ?? 0);

    // Look for next task
    const nextTaskResult = await pool.query<{
      task_id: string;
      target_gers_id: string;
      cost_food: number;
      cost_equipment: number;
      cost_energy: number;
      cost_materials: number;
    }>(
      `
      SELECT task_id, target_gers_id, cost_food, cost_equipment, cost_energy, cost_materials
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

    const nextTask = nextTaskResult.rows[0];

    if (nextTask) {
      // Dispatch directly to next task
      const crewEvent = await dispatchCrewToTask(pool, crew, nextTask);
      if (crewEvent) {
        crewEvents.push(crewEvent);
      }
    } else {
      // Return to hub
      const crewEvent = await returnCrewToHub(pool, crew);
      if (crewEvent) {
        crewEvents.push(crewEvent);
      }
    }
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
    feedItems,
    crewEvents
  };
}

/**
 * Helper: Dispatch a crew directly to a task (for direct routing after completion)
 */
async function dispatchCrewToTask(
  pool: PoolLike,
  crew: { crew_id: string; region_id: string; current_lng: number | null; current_lat: number | null },
  task: { task_id: string; target_gers_id: string; cost_food: number; cost_equipment: number; cost_energy: number; cost_materials: number }
): Promise<CrewEvent | null> {
  // Get road center for destination
  const roadResult = await pool.query<{ road_lon: number; road_lat: number }>(
    `SELECT (bbox_xmin + bbox_xmax) / 2 AS road_lon, (bbox_ymin + bbox_ymax) / 2 AS road_lat
     FROM world_features WHERE gers_id = $1`,
    [task.target_gers_id]
  );
  const road = roadResult.rows[0];
  if (!road) return null;

  // Calculate path and waypoints
  let travelTimeS = CREW_TRAVEL_MIN_S;
  let waypoints: CrewWaypoint[] | null = null;
  const departAt = Date.now();

  if (crew.current_lng != null && crew.current_lat != null) {
    const graphData = await loadGraphForRegion(pool, crew.region_id);
    const startPoint: Point = [crew.current_lng, crew.current_lat];
    const roadPoint: Point = [road.road_lon, road.road_lat];

    if (graphData) {
      const startConnector = findNearestConnector(graphData.coords, startPoint);
      const endConnector = findNearestConnector(graphData.coords, roadPoint);

      if (startConnector && endConnector) {
        const pathResult = findPath(graphData.graph, graphData.coords, startConnector, endConnector);
        if (pathResult) {
          waypoints = buildWaypoints(pathResult, graphData.coords, departAt, CREW_TRAVEL_MPS, {
            actualStart: startPoint,
            actualEnd: roadPoint,
          });
          if (waypoints.length > 1) {
            const lastWaypoint = waypoints[waypoints.length - 1];
            travelTimeS = (Date.parse(lastWaypoint.arrive_at) - departAt) / 1000;
          }
        } else {
          // Pathfinding failed - use straight-line fallback
          travelTimeS = haversineDistanceMeters(startPoint, roadPoint) / CREW_TRAVEL_MPS;
          waypoints = buildStraightLineWaypoints(startPoint, roadPoint, departAt, travelTimeS);
        }
      } else {
        // No connectors found - use straight-line fallback
        travelTimeS = haversineDistanceMeters(startPoint, roadPoint) / CREW_TRAVEL_MPS;
        waypoints = buildStraightLineWaypoints(startPoint, roadPoint, departAt, travelTimeS);
      }
    } else {
      // No graph data - use straight-line fallback
      travelTimeS = haversineDistanceMeters(startPoint, roadPoint) / CREW_TRAVEL_MPS;
      waypoints = buildStraightLineWaypoints(startPoint, roadPoint, departAt, travelTimeS);
    }
  }

  travelTimeS = Math.max(CREW_TRAVEL_MIN_S, Math.min(CREW_TRAVEL_MAX_S, travelTimeS));

  // Deduct resources
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

  // Update task to active
  await pool.query("UPDATE tasks SET status = 'active' WHERE task_id = $1", [task.task_id]);

  // Update crew to traveling
  await pool.query(
    `UPDATE crews SET
      status = 'traveling',
      active_task_id = $2,
      busy_until = now() + ($3 * interval '1 second'),
      waypoints = $4,
      path_started_at = now()
    WHERE crew_id = $1`,
    [crew.crew_id, task.task_id, travelTimeS, waypoints ? JSON.stringify(waypoints) : null]
  );

  // Insert crew_dispatched event
  await pool.query(
    "INSERT INTO events (event_type, region_id, payload) VALUES ('crew_dispatched', $1, $2::jsonb)",
    [crew.region_id, JSON.stringify({ crew_id: crew.crew_id, task_id: task.task_id, waypoints })]
  );

  return {
    crew_id: crew.crew_id,
    region_id: crew.region_id,
    event_type: "crew_dispatched",
    waypoints,
    task_id: task.task_id
  };
}

/**
 * Helper: Return a crew to their home hub (or any hub if no home assigned)
 */
async function returnCrewToHub(
  pool: PoolLike,
  crew: { crew_id: string; region_id: string; current_lng: number | null; current_lat: number | null; home_hub_gers_id?: string | null }
): Promise<CrewEvent | null> {
  // Get hub position - prefer crew's home hub, fallback to any hub in region
  const hubResult = await pool.query<{ hub_lon: number; hub_lat: number }>(
    `SELECT COALESCE(ST_X(ST_PointOnSurface(hub.geom)), (hub.bbox_xmin + hub.bbox_xmax) / 2) AS hub_lon,
            COALESCE(ST_Y(ST_PointOnSurface(hub.geom)), (hub.bbox_ymin + hub.bbox_ymax) / 2) AS hub_lat
     FROM world_features hub
     WHERE hub.gers_id = COALESCE($2, (
       SELECT h.hub_building_gers_id FROM hex_cells h
       WHERE h.region_id = $1 AND h.hub_building_gers_id IS NOT NULL
       LIMIT 1
     ))`,
    [crew.region_id, crew.home_hub_gers_id]
  );
  const hub = hubResult.rows[0];

  if (!hub || crew.current_lng == null || crew.current_lat == null) {
    // No hub or no position, just set idle at current location
    await pool.query(
      "UPDATE crews SET status = 'idle', active_task_id = NULL, busy_until = NULL WHERE crew_id = $1",
      [crew.crew_id]
    );
    return {
      crew_id: crew.crew_id,
      region_id: crew.region_id,
      event_type: "crew_idle",
      position: crew.current_lng && crew.current_lat ? { lng: crew.current_lng, lat: crew.current_lat } : null
    };
  }

  // Calculate path back to hub
  let travelTimeS = CREW_TRAVEL_MIN_S;
  let waypoints: CrewWaypoint[] | null = null;
  const departAt = Date.now();

  const graphData = await loadGraphForRegion(pool, crew.region_id);
  const startPoint: Point = [crew.current_lng, crew.current_lat];
  const hubPoint: Point = [hub.hub_lon, hub.hub_lat];

  if (graphData) {
    const startConnector = findNearestConnector(graphData.coords, startPoint);
    const endConnector = findNearestConnector(graphData.coords, hubPoint);

    if (startConnector && endConnector) {
      const pathResult = findPath(graphData.graph, graphData.coords, startConnector, endConnector);
      if (pathResult) {
        waypoints = buildWaypoints(pathResult, graphData.coords, departAt, CREW_TRAVEL_MPS, {
          actualStart: startPoint,
          actualEnd: hubPoint,
        });
        if (waypoints.length > 1) {
          const lastWaypoint = waypoints[waypoints.length - 1];
          travelTimeS = (Date.parse(lastWaypoint.arrive_at) - departAt) / 1000;
        }
      } else {
        // Pathfinding failed - use straight-line fallback
        travelTimeS = haversineDistanceMeters(startPoint, hubPoint) / CREW_TRAVEL_MPS;
        waypoints = buildStraightLineWaypoints(startPoint, hubPoint, departAt, travelTimeS);
      }
    } else {
      // No connectors found - use straight-line fallback
      travelTimeS = haversineDistanceMeters(startPoint, hubPoint) / CREW_TRAVEL_MPS;
      waypoints = buildStraightLineWaypoints(startPoint, hubPoint, departAt, travelTimeS);
    }
  } else {
    // No graph data - use straight-line fallback
    travelTimeS = haversineDistanceMeters(startPoint, hubPoint) / CREW_TRAVEL_MPS;
    waypoints = buildStraightLineWaypoints(startPoint, hubPoint, departAt, travelTimeS);
  }

  travelTimeS = Math.max(CREW_TRAVEL_MIN_S, Math.min(CREW_TRAVEL_MAX_S, travelTimeS));

  // Update crew to traveling (no active_task_id since returning to hub)
  await pool.query(
    `UPDATE crews SET
      status = 'traveling',
      active_task_id = NULL,
      busy_until = now() + ($2 * interval '1 second'),
      waypoints = $3,
      path_started_at = now()
    WHERE crew_id = $1`,
    [crew.crew_id, travelTimeS, waypoints ? JSON.stringify(waypoints) : null]
  );

  // Insert crew_returning event
  await pool.query(
    "INSERT INTO events (event_type, region_id, payload) VALUES ('crew_returning', $1, $2::jsonb)",
    [crew.region_id, JSON.stringify({ crew_id: crew.crew_id, waypoints })]
  );

  return {
    crew_id: crew.crew_id,
    region_id: crew.region_id,
    event_type: "crew_returning",
    waypoints
  };
}
