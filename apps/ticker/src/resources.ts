import type { PoolLike } from "./ticker";
import type { PhaseMultipliers } from "./multipliers";
import { logger } from "./logger";
import {
  type Graph,
  type ConnectorCoords,
  type Point,
  findPath,
  findNearestConnector,
  buildWaypoints,
} from "@nightfall/pathfinding";

export type ResourceTransfer = {
  transfer_id: string;
  region_id: string;
  source_gers_id: string | null;
  hub_gers_id: string | null;
  resource_type: "food" | "equipment" | "energy" | "materials";
  amount: number;
  depart_at: string;
  arrive_at: string;
  path_waypoints?: { coord: Point; arrive_at: string }[] | null;
};

type ArrivalResult = {
  regionIds: string[];
};

const RESOURCE_TRAVEL_MPS = Math.max(0.1, Number(process.env.RESOURCE_TRAVEL_MPS ?? 8) || 8);
const RESOURCE_DISTANCE_MULTIPLIER = Math.max(0.1, Number(process.env.RESOURCE_DISTANCE_MULTIPLIER ?? 1.25) || 1.25);
const RESOURCE_TRAVEL_MIN_S = Math.max(1, Number(process.env.RESOURCE_TRAVEL_MIN_S ?? 4) || 4);
const RESOURCE_TRAVEL_MAX_S = Math.max(RESOURCE_TRAVEL_MIN_S, Number(process.env.RESOURCE_TRAVEL_MAX_S ?? 45) || 45);
const RESOURCE_TABLE_CHECK_INTERVAL_MS = Math.max(
  5_000,
  Number(process.env.RESOURCE_TABLE_CHECK_INTERVAL_MS ?? 60_000) || 60_000
);

let resourceTransfersTableReady: boolean | null = null;
let lastResourceTransfersCheckMs = 0;
let loggedMissingResourceTransfers = false;

async function ensureResourceTransfersTable(pool: PoolLike): Promise<boolean> {
  const now = Date.now();
  if (resourceTransfersTableReady === true) {
    return true;
  }
  if (
    resourceTransfersTableReady === false &&
    now - lastResourceTransfersCheckMs < RESOURCE_TABLE_CHECK_INTERVAL_MS
  ) {
    return false;
  }

  lastResourceTransfersCheckMs = now;

  try {
    const result = await pool.query<{ exists: string | null }>(
      "SELECT to_regclass('public.resource_transfers') AS exists"
    );
    const exists = Boolean(result.rows[0]?.exists);
    resourceTransfersTableReady = exists;

    if (!exists && !loggedMissingResourceTransfers) {
      loggedMissingResourceTransfers = true;
      logger.error("[ticker] missing resource_transfers table; run `pnpm db:up`");
    }

    return exists;
  } catch (error) {
    resourceTransfersTableReady = false;
    if (!loggedMissingResourceTransfers) {
      loggedMissingResourceTransfers = true;
      logger.error({ err: error }, "[ticker] failed checking resource_transfers table");
    }
    return false;
  }
}

export function resetResourceTransferCacheForTests() {
  resourceTransfersTableReady = null;
  lastResourceTransfersCheckMs = 0;
  loggedMissingResourceTransfers = false;
}

// Graph cache per hex (simple in-memory cache)
const graphCache = new Map<string, { graph: Graph; coords: ConnectorCoords; timestamp: number }>();
const GRAPH_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function loadGraphForHex(
  pool: PoolLike,
  h3Index: string
): Promise<{ graph: Graph; coords: ConnectorCoords } | null> {
  // Check cache
  const cached = graphCache.get(h3Index);
  if (cached && Date.now() - cached.timestamp < GRAPH_CACHE_TTL_MS) {
    return { graph: cached.graph, coords: cached.coords };
  }

  try {
    // Load connectors for this hex
    const connectorsResult = await pool.query<{
      connector_id: string;
      lng: number;
      lat: number;
    }>(
      `SELECT connector_id, lng, lat FROM road_connectors WHERE h3_index = $1`,
      [h3Index]
    );

    if (connectorsResult.rows.length === 0) {
      return null;
    }

    const coords: ConnectorCoords = new Map();
    for (const row of connectorsResult.rows) {
      coords.set(row.connector_id, [row.lng, row.lat]);
    }

    // Load edges with health
    const edgesResult = await pool.query<{
      from_connector: string;
      to_connector: string;
      segment_gers_id: string;
      length_meters: number;
      health: number;
    }>(
      `SELECT
        e.from_connector,
        e.to_connector,
        e.segment_gers_id,
        e.length_meters,
        COALESCE(fs.health, 100) as health
      FROM road_edges e
      LEFT JOIN feature_state fs ON fs.gers_id = e.segment_gers_id
      WHERE e.h3_index = $1`,
      [h3Index]
    );

    // Build adjacency list
    const graph: Graph = new Map();
    for (const row of edgesResult.rows) {
      if (!graph.has(row.from_connector)) {
        graph.set(row.from_connector, []);
      }
      graph.get(row.from_connector)!.push({
        segmentGersId: row.segment_gers_id,
        toConnector: row.to_connector,
        lengthMeters: row.length_meters,
        health: row.health,
      });
    }

    // Cache the result
    graphCache.set(h3Index, { graph, coords, timestamp: Date.now() });

    return { graph, coords };
  } catch (error) {
    logger.error({ err: error, h3Index }, "[ticker] failed to load road graph");
    return null;
  }
}

export function invalidateGraphCache() {
  graphCache.clear();
}

type BuildingOutput = {
  source_gers_id: string;
  region_id: string;
  h3_index: string;
  hub_gers_id: string;
  source_lon: number;
  source_lat: number;
  hub_lon: number;
  hub_lat: number;
  food_amount: number;
  equipment_amount: number;
  energy_amount: number;
  materials_amount: number;
};

export async function enqueueResourceTransfers(
  pool: PoolLike,
  multipliers: PhaseMultipliers
): Promise<ResourceTransfer[]> {
  if (!(await ensureResourceTransfersTable(pool))) {
    return [];
  }

  // Step 1: Query buildings with resource outputs and coordinates
  const buildingsResult = await pool.query<BuildingOutput>(
    `
    WITH feature_rust AS (
      SELECT
        wf.gers_id,
        wf.region_id,
        wf.h3_index,
        wf.generates_food,
        wf.generates_equipment,
        wf.generates_energy,
        wf.generates_materials,
        AVG(h.rust_level) AS rust_level
      FROM world_features AS wf
      JOIN world_feature_hex_cells AS wfhc ON wfhc.gers_id = wf.gers_id
      JOIN hex_cells AS h ON h.h3_index = wfhc.h3_index
      WHERE wf.feature_type = 'building'
      GROUP BY wf.gers_id, wf.region_id, wf.h3_index, wf.generates_food, wf.generates_equipment, wf.generates_energy, wf.generates_materials
    ),
    building_outputs AS (
      SELECT
        fr.gers_id AS source_gers_id,
        fr.region_id,
        fr.h3_index,
        GREATEST(0, FLOOR(
          CASE WHEN fr.generates_food THEN (1 - fr.rust_level) * $1 ELSE 0 END
        ))::int AS food_amount,
        GREATEST(0, FLOOR(
          CASE WHEN fr.generates_equipment THEN (1 - fr.rust_level) * $1 ELSE 0 END
        ))::int AS equipment_amount,
        GREATEST(0, FLOOR(
          CASE WHEN fr.generates_energy THEN (1 - fr.rust_level) * $1 ELSE 0 END
        ))::int AS energy_amount,
        GREATEST(0, FLOOR(
          CASE WHEN fr.generates_materials THEN (1 - fr.rust_level) * $1 ELSE 0 END
        ))::int AS materials_amount
      FROM feature_rust AS fr
    ),
    hub_lookup AS (
      SELECT
        h.h3_index,
        h.hub_building_gers_id,
        (hub.bbox_xmin + hub.bbox_xmax) / 2 AS hub_lon,
        (hub.bbox_ymin + hub.bbox_ymax) / 2 AS hub_lat
      FROM hex_cells AS h
      JOIN world_features AS hub ON hub.gers_id = h.hub_building_gers_id
    )
    SELECT
      bo.source_gers_id,
      bo.region_id,
      bo.h3_index,
      hub_lookup.hub_building_gers_id AS hub_gers_id,
      (wf.bbox_xmin + wf.bbox_xmax) / 2 AS source_lon,
      (wf.bbox_ymin + wf.bbox_ymax) / 2 AS source_lat,
      hub_lookup.hub_lon,
      hub_lookup.hub_lat,
      bo.food_amount,
      bo.equipment_amount,
      bo.energy_amount,
      bo.materials_amount
    FROM building_outputs AS bo
    JOIN world_features AS wf ON wf.gers_id = bo.source_gers_id
    JOIN hub_lookup ON hub_lookup.h3_index = bo.h3_index
    WHERE hub_lookup.hub_building_gers_id IS NOT NULL
      AND (bo.food_amount > 0 OR bo.equipment_amount > 0 OR bo.energy_amount > 0 OR bo.materials_amount > 0)
    `,
    [multipliers.generation]
  );

  if (buildingsResult.rows.length === 0) {
    return [];
  }

  // Step 2: Group buildings by h3_index for graph loading
  const buildingsByHex = new Map<string, BuildingOutput[]>();
  for (const building of buildingsResult.rows) {
    if (!buildingsByHex.has(building.h3_index)) {
      buildingsByHex.set(building.h3_index, []);
    }
    buildingsByHex.get(building.h3_index)!.push(building);
  }

  // Step 3: Calculate paths and prepare transfers
  const transfers: Array<{
    region_id: string;
    source_gers_id: string;
    hub_gers_id: string;
    resource_type: string;
    amount: number;
    waypoints: { coord: Point; arrive_at: string }[] | null;
    travel_seconds: number;
  }> = [];

  const departAt = Date.now();

  for (const [h3Index, buildings] of buildingsByHex) {
    // Load graph for this hex
    const graphData = await loadGraphForHex(pool, h3Index);

    for (const building of buildings) {
      let waypoints: { coord: Point; arrive_at: string }[] | null = null;
      let travelSeconds: number;

      if (graphData) {
        // Find nearest connectors to source and hub
        const sourcePoint: Point = [building.source_lon, building.source_lat];
        const hubPoint: Point = [building.hub_lon, building.hub_lat];

        const startConnector = findNearestConnector(graphData.coords, sourcePoint);
        const endConnector = findNearestConnector(graphData.coords, hubPoint);

        if (startConnector && endConnector) {
          const pathResult = findPath(
            graphData.graph,
            graphData.coords,
            startConnector,
            endConnector
          );

          if (pathResult) {
            // Build waypoints with per-segment timing
            waypoints = buildWaypoints(pathResult, graphData.coords, departAt, RESOURCE_TRAVEL_MPS);

            // Calculate travel time from waypoints
            if (waypoints.length > 1) {
              const lastWaypoint = waypoints[waypoints.length - 1];
              travelSeconds = (Date.parse(lastWaypoint.arrive_at) - departAt) / 1000;
            } else {
              travelSeconds = RESOURCE_TRAVEL_MIN_S;
            }

            // Clamp to min/max
            travelSeconds = Math.max(RESOURCE_TRAVEL_MIN_S, Math.min(RESOURCE_TRAVEL_MAX_S, travelSeconds));
          } else {
            // No path found, fallback to direct distance
            travelSeconds = calculateFallbackTravelTime(building);
          }
        } else {
          // No connectors found, fallback
          travelSeconds = calculateFallbackTravelTime(building);
        }
      } else {
        // No graph data, fallback to haversine
        travelSeconds = calculateFallbackTravelTime(building);
      }

      // Create transfers for each resource type
      const resourceTypes: Array<{ type: string; amount: number }> = [];
      if (building.food_amount > 0) resourceTypes.push({ type: "food", amount: building.food_amount });
      if (building.equipment_amount > 0) resourceTypes.push({ type: "equipment", amount: building.equipment_amount });
      if (building.energy_amount > 0) resourceTypes.push({ type: "energy", amount: building.energy_amount });
      if (building.materials_amount > 0) resourceTypes.push({ type: "materials", amount: building.materials_amount });

      for (const { type, amount } of resourceTypes) {
        transfers.push({
          region_id: building.region_id,
          source_gers_id: building.source_gers_id,
          hub_gers_id: building.hub_gers_id,
          resource_type: type,
          amount,
          waypoints,
          travel_seconds: travelSeconds,
        });
      }
    }
  }

  if (transfers.length === 0) {
    return [];
  }

  // Step 4: Batch insert transfers
  const insertedTransfers: ResourceTransfer[] = [];
  const BATCH_SIZE = 100;

  for (let i = 0; i < transfers.length; i += BATCH_SIZE) {
    const batch = transfers.slice(i, i + BATCH_SIZE);
    const values: (string | number | null)[] = [];
    const placeholders: string[] = [];

    batch.forEach((t, idx) => {
      const offset = idx * 7;
      placeholders.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, now(), now() + ($${offset + 6} || ' seconds')::interval, $${offset + 7}::jsonb)`
      );
      values.push(
        t.region_id,
        t.source_gers_id,
        t.hub_gers_id,
        t.resource_type,
        t.amount,
        t.travel_seconds.toString(),
        t.waypoints ? JSON.stringify(t.waypoints) : null
      );
    });

    const result = await pool.query<ResourceTransfer>(
      `INSERT INTO resource_transfers (
        region_id,
        source_gers_id,
        hub_gers_id,
        resource_type,
        amount,
        depart_at,
        arrive_at,
        path_waypoints
      )
      VALUES ${placeholders.join(", ")}
      RETURNING
        transfer_id,
        region_id,
        source_gers_id,
        hub_gers_id,
        resource_type,
        amount,
        depart_at::text,
        arrive_at::text,
        path_waypoints`,
      values
    );

    insertedTransfers.push(...result.rows);
  }

  return insertedTransfers;
}

function calculateFallbackTravelTime(building: BuildingOutput): number {
  // Haversine distance fallback
  const R = 6371e3; // Earth radius in meters
  const lat1 = (building.source_lat * Math.PI) / 180;
  const lat2 = (building.hub_lat * Math.PI) / 180;
  const dLat = ((building.hub_lat - building.source_lat) * Math.PI) / 180;
  const dLon = ((building.hub_lon - building.source_lon) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  const travelSeconds = (distance * RESOURCE_DISTANCE_MULTIPLIER) / RESOURCE_TRAVEL_MPS;
  return Math.max(RESOURCE_TRAVEL_MIN_S, Math.min(RESOURCE_TRAVEL_MAX_S, travelSeconds));
}

export async function applyArrivedResourceTransfers(pool: PoolLike): Promise<ArrivalResult> {
  if (!(await ensureResourceTransfersTable(pool))) {
    return { regionIds: [] };
  }

  const result = await pool.query<{ region_id: string }>(
    `
    WITH arrived AS (
      SELECT transfer_id, region_id, resource_type, amount
      FROM resource_transfers
      WHERE status = 'in_transit'
        AND arrive_at <= now()
      FOR UPDATE SKIP LOCKED
    ),
    totals AS (
      SELECT
        region_id,
        SUM(CASE WHEN resource_type = 'food' THEN amount ELSE 0 END)::bigint AS food,
        SUM(CASE WHEN resource_type = 'equipment' THEN amount ELSE 0 END)::bigint AS equipment,
        SUM(CASE WHEN resource_type = 'energy' THEN amount ELSE 0 END)::bigint AS energy,
        SUM(CASE WHEN resource_type = 'materials' THEN amount ELSE 0 END)::bigint AS materials
      FROM arrived
      GROUP BY region_id
    ),
    updated_regions AS (
      UPDATE regions AS r
      SET
        pool_food = r.pool_food + COALESCE(totals.food, 0),
        pool_equipment = r.pool_equipment + COALESCE(totals.equipment, 0),
        pool_energy = r.pool_energy + COALESCE(totals.energy, 0),
        pool_materials = r.pool_materials + COALESCE(totals.materials, 0),
        updated_at = now()
      FROM totals
      WHERE r.region_id = totals.region_id
      RETURNING r.region_id
    )
    UPDATE resource_transfers AS rt
    SET status = 'arrived'
    WHERE rt.transfer_id IN (SELECT transfer_id FROM arrived)
    RETURNING rt.region_id
    `
  );

  const regionIds = Array.from(new Set(result.rows.map((row) => row.region_id)));
  return { regionIds };
}
