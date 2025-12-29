/**
 * Building routes: activate
 */

import type { FastifyInstance } from "fastify";
import { getPool } from "../db";
import { getConfig } from "../config";
import { verifyToken } from "../utils/auth";
import { BUILDING_ACTIVATION_MS } from "../utils/constants";
import { loadCycleState } from "../cycle";
import { loadGraphForRegion } from "../services/graph";
import { clamp, haversineDistanceMeters } from "../utils/helpers";
import { getPhaseMultipliers } from "@nightfall/config";
import {
  type Point,
  findPath,
  findNearestConnector,
  buildWaypoints
} from "@nightfall/pathfinding";

export function registerBuildingRoutes(app: FastifyInstance) {
  /**
   * Simple building activation (no boost)
   * Activates a building to start auto-generating resources for 2 minutes
   */
  app.post("/api/building/activate", async (request, reply) => {
    const body = request.body as {
      client_id?: string;
      building_gers_id?: string;
    } | undefined;

    const clientId = body?.client_id?.trim();
    const buildingGersId = body?.building_gers_id?.trim();
    const authHeader = request.headers["authorization"];

    if (!clientId || !buildingGersId) {
      reply.status(400);
      return { ok: false, error: "client_id_and_building_required" };
    }

    if (!authHeader || !verifyToken(clientId, authHeader)) {
      reply.status(401);
      return { ok: false, error: "unauthorized" };
    }

    const pool = getPool();

    // Check if building exists and is a resource-generating building
    const buildingResult = await pool.query<{
      gers_id: string;
      generates_food: boolean;
      generates_equipment: boolean;
      generates_energy: boolean;
      generates_materials: boolean;
    }>(
      `
      SELECT wf.gers_id, wf.generates_food, wf.generates_equipment,
             wf.generates_energy, wf.generates_materials
      FROM world_features wf
      WHERE wf.gers_id = $1 AND wf.feature_type = 'building'
      `,
      [buildingGersId]
    );

    const building = buildingResult.rows[0];
    if (!building) {
      reply.status(404);
      return { ok: false, error: "building_not_found" };
    }

    const canGenerate = building.generates_food || building.generates_equipment ||
                        building.generates_energy || building.generates_materials;
    if (!canGenerate) {
      reply.status(400);
      return { ok: false, error: "building_not_resource_generating" };
    }

    // Check if already activated (within activation window)
    const stateResult = await pool.query<{ last_activated_at: Date }>(
      `SELECT last_activated_at FROM feature_state WHERE gers_id = $1`,
      [buildingGersId]
    );

    const now = new Date();
    const lastActivatedAt = stateResult.rows[0]?.last_activated_at;
    if (lastActivatedAt) {
      const activationExpiresAt = new Date(lastActivatedAt.getTime() + BUILDING_ACTIVATION_MS);
      if (activationExpiresAt > now) {
        // Already activated, return current activation info
        return {
          ok: true,
          already_activated: true,
          activated_at: lastActivatedAt.toISOString(),
          expires_at: activationExpiresAt.toISOString(),
        };
      }
    }

    // Activate the building
    const activatedAt = now;
    const expiresAt = new Date(now.getTime() + BUILDING_ACTIVATION_MS);

    await pool.query(
      `INSERT INTO feature_state (gers_id, last_activated_at)
       VALUES ($1, $2)
       ON CONFLICT (gers_id) DO UPDATE SET last_activated_at = $2`,
      [buildingGersId, activatedAt]
    );

    // Emit activation event via pg_notify for SSE
    await pool.query("SELECT pg_notify($1, $2)", [
      "building_activation",
      JSON.stringify({
        building_gers_id: buildingGersId,
        activated_at: activatedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        client_id: clientId,
      })
    ]);

    // Create immediate resource transfer instead of waiting for ticker
    // This eliminates the ~10 second delay before convoy appears
    let immediateTransfer = null;
    try {
      immediateTransfer = await createImmediateTransfer(pool, buildingGersId, building);
    } catch (err) {
      // Log but don't fail activation - ticker will pick it up anyway
      app.log.warn({ err, buildingGersId }, "Failed to create immediate transfer");
    }

    return {
      ok: true,
      already_activated: false,
      activated_at: activatedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      transfer: immediateTransfer,
    };
  });
}

type PoolLike = {
  query: <T = unknown>(text: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount: number }>;
};

type BuildingInfo = {
  generates_food: boolean;
  generates_equipment: boolean;
  generates_energy: boolean;
  generates_materials: boolean;
};

type TransferResult = {
  transfer_id: string;
  region_id: string;
  source_gers_id: string | null;
  hub_gers_id: string | null;
  resource_type: "food" | "equipment" | "energy" | "materials";
  amount: number;
  depart_at: string;
  arrive_at: string;
  path_waypoints: { coord: Point; arrive_at: string }[] | null;
};

/**
 * Create a resource transfer immediately when a building is activated,
 * eliminating the delay of waiting for the next ticker cycle.
 */
async function createImmediateTransfer(
  pool: PoolLike,
  buildingGersId: string,
  building: BuildingInfo
): Promise<TransferResult | null> {
  // Check if there's already an in_transit transfer for this building
  const existingResult = await pool.query<{ transfer_id: string }>(
    `SELECT transfer_id FROM resource_transfers
     WHERE source_gers_id = $1 AND status = 'in_transit'
     LIMIT 1`,
    [buildingGersId]
  );

  if (existingResult.rows.length > 0) {
    return null; // Already has a convoy in transit
  }

  // Get building location, region, rust level, and boost info
  const buildingDataResult = await pool.query<{
    region_id: string;
    source_lon: number;
    source_lat: number;
    rust_level: number;
    boost_multiplier: number | null;
    hub_gers_id: string | null;
    hub_lon: number | null;
    hub_lat: number | null;
  }>(
    `
    WITH building_hex AS (
      SELECT
        wf.gers_id,
        wf.region_id,
        COALESCE(ST_X(ST_PointOnSurface(wf.geom)), (wf.bbox_xmin + wf.bbox_xmax) / 2) AS source_lon,
        COALESCE(ST_Y(ST_PointOnSurface(wf.geom)), (wf.bbox_ymin + wf.bbox_ymax) / 2) AS source_lat,
        wfhc.h3_index
      FROM world_features wf
      JOIN world_feature_hex_cells wfhc ON wfhc.gers_id = wf.gers_id
      WHERE wf.gers_id = $1
      LIMIT 1
    ),
    hex_rust AS (
      SELECT
        bh.*,
        COALESCE(h.rust_level, 0) AS rust_level,
        h.hub_building_gers_id
      FROM building_hex bh
      JOIN hex_cells h ON h.h3_index = bh.h3_index
    ),
    active_boost AS (
      SELECT multiplier FROM production_boosts
      WHERE building_gers_id = $1 AND expires_at > now()
      LIMIT 1
    )
    SELECT
      hr.region_id,
      hr.source_lon,
      hr.source_lat,
      hr.rust_level::float,
      ab.multiplier AS boost_multiplier,
      hub.gers_id AS hub_gers_id,
      COALESCE(ST_X(ST_PointOnSurface(hub.geom)), (hub.bbox_xmin + hub.bbox_xmax) / 2) AS hub_lon,
      COALESCE(ST_Y(ST_PointOnSurface(hub.geom)), (hub.bbox_ymin + hub.bbox_ymax) / 2) AS hub_lat
    FROM hex_rust hr
    LEFT JOIN active_boost ab ON true
    LEFT JOIN world_features hub ON hub.gers_id = hr.hub_building_gers_id
    `,
    [buildingGersId]
  );

  const buildingData = buildingDataResult.rows[0];
  if (!buildingData || !buildingData.hub_gers_id || buildingData.hub_lon === null || buildingData.hub_lat === null) {
    return null; // No hub found
  }

  // Get current cycle phase for generation multiplier
  const cycle = await loadCycleState(pool);
  const phaseMultipliers = getPhaseMultipliers(cycle.phase);
  const generationMultiplier = phaseMultipliers.generation;
  const boostMultiplier = buildingData.boost_multiplier ?? 1;
  const rustFactor = 1 - buildingData.rust_level;

  // Calculate resource amount
  const baseAmount = Math.floor(rustFactor * generationMultiplier * boostMultiplier);
  if (baseAmount <= 0) {
    return null; // No resources to generate
  }

  // Determine resource type (pick first available)
  let resourceType: "food" | "equipment" | "energy" | "materials";
  if (building.generates_food) {
    resourceType = "food";
  } else if (building.generates_equipment) {
    resourceType = "equipment";
  } else if (building.generates_energy) {
    resourceType = "energy";
  } else if (building.generates_materials) {
    resourceType = "materials";
  } else {
    return null;
  }

  // Get config values for travel time calculation
  const config = getConfig();

  // Calculate path and travel time
  const sourceCenter: [number, number] = [buildingData.source_lon, buildingData.source_lat];
  const hubCenter: [number, number] = [buildingData.hub_lon, buildingData.hub_lat];

  let travelSeconds: number;
  let pathWaypoints: { coord: Point; arrive_at: string }[] | null = null;
  const departAtMs = Date.now();

  const graphData = await loadGraphForRegion(buildingData.region_id);
  if (graphData) {
    const { graph, coords } = graphData;
    const startConnector = findNearestConnector(coords, sourceCenter as Point);
    const endConnector = findNearestConnector(coords, hubCenter as Point);

    if (startConnector && endConnector) {
      const pathResult = findPath(graph, coords, startConnector, endConnector);
      if (pathResult) {
        travelSeconds = clamp(
          pathResult.totalWeightedDistance / config.RESOURCE_TRAVEL_MPS,
          config.RESOURCE_TRAVEL_MIN_S,
          config.RESOURCE_TRAVEL_MAX_S
        );
        pathWaypoints = buildWaypoints(
          pathResult,
          coords,
          departAtMs,
          config.RESOURCE_TRAVEL_MPS,
          { actualStart: sourceCenter as Point, actualEnd: hubCenter as Point }
        );
      } else {
        // No path found, use haversine fallback
        travelSeconds = calculateHaversineTravelTime(sourceCenter, hubCenter, config);
      }
    } else {
      // No connectors, use haversine fallback
      travelSeconds = calculateHaversineTravelTime(sourceCenter, hubCenter, config);
    }
  } else {
    // No graph data, use haversine fallback
    travelSeconds = calculateHaversineTravelTime(sourceCenter, hubCenter, config);
  }

  // Insert the transfer
  const transferResult = await pool.query<TransferResult>(
    `
    INSERT INTO resource_transfers (
      region_id,
      source_gers_id,
      hub_gers_id,
      resource_type,
      amount,
      depart_at,
      arrive_at,
      path_waypoints
    )
    VALUES ($1, $2, $3, $4, $5, now(), now() + ($6 || ' seconds')::interval, $7::jsonb)
    ON CONFLICT DO NOTHING
    RETURNING
      transfer_id,
      region_id,
      source_gers_id,
      hub_gers_id,
      resource_type,
      amount,
      depart_at::text,
      arrive_at::text,
      path_waypoints
    `,
    [
      buildingData.region_id,
      buildingGersId,
      buildingData.hub_gers_id,
      resourceType,
      baseAmount,
      travelSeconds.toString(),
      pathWaypoints ? JSON.stringify(pathWaypoints) : null
    ]
  );

  const transfer = transferResult.rows[0];
  if (!transfer) {
    return null; // Conflict (duplicate transfer)
  }

  // Publish SSE event immediately
  await pool.query("SELECT pg_notify($1, $2)", [
    "resource_transfer",
    JSON.stringify(transfer)
  ]);

  return transfer;
}

/**
 * Calculate travel time using haversine distance as a fallback
 * when road graph pathfinding is not available.
 */
function calculateHaversineTravelTime(
  source: [number, number],
  hub: [number, number],
  config: ReturnType<typeof getConfig>
): number {
  const distanceMeters = haversineDistanceMeters(source, hub);
  return clamp(
    (distanceMeters * config.RESOURCE_DISTANCE_MULTIPLIER) / config.RESOURCE_TRAVEL_MPS,
    config.RESOURCE_TRAVEL_MIN_S,
    config.RESOURCE_TRAVEL_MAX_S
  );
}
