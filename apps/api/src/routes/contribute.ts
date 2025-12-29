/**
 * Resource contribution route
 */

import type { FastifyInstance } from "fastify";
import type { RouteContext } from "./types";
import { getPool } from "../db";
import { verifyToken } from "../utils/auth";
import { clamp, haversineDistanceMeters } from "../utils/helpers";
import { loadGraphForRegion } from "../services/graph";
import { awardPlayerScore } from "../services/score";
import {
  CONTRIBUTION_LIMIT,
  TAX_MULTIPLIER,
  MAX_CLIENT_ID_LENGTH,
  MAX_REGION_ID_LENGTH
} from "../utils/constants";
import { SCORE_ACTIONS } from "@nightfall/config";
import {
  type Point,
  findPath,
  findNearestConnector,
  buildWaypoints
} from "@nightfall/pathfinding";

export function registerContributeRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { config } = ctx;

  app.post("/api/contribute", async (request, reply) => {
    const body = request.body as {
      client_id?: string;
      region_id?: string;
      food?: number;
      equipment?: number;
      energy?: number;
      materials?: number;
      source_gers_id?: string;
    } | undefined;

    const clientId = body?.client_id?.trim();
    const regionId = body?.region_id?.trim();
    const food = Number(body?.food ?? 0);
    const equipment = Number(body?.equipment ?? 0);
    const energy = Number(body?.energy ?? 0);
    const materials = Number(body?.materials ?? 0);
    const sourceGersId = body?.source_gers_id?.trim();
    const authHeader = request.headers["authorization"];

    if (!clientId || !regionId) {
      reply.status(400);
      return { ok: false, error: "client_id_and_region_required" };
    }

    if (!authHeader || !verifyToken(clientId, authHeader)) {
      reply.status(401);
      return { ok: false, error: "unauthorized" };
    }

    if (clientId.length > MAX_CLIENT_ID_LENGTH) {
      reply.status(400);
      return { ok: false, error: "client_id_too_long" };
    }

    if (regionId.length > MAX_REGION_ID_LENGTH) {
      reply.status(400);
      return { ok: false, error: "region_id_too_long" };
    }

    if (
      !Number.isFinite(food) || !Number.isFinite(equipment) ||
      !Number.isFinite(energy) || !Number.isFinite(materials) ||
      food < 0 || equipment < 0 || energy < 0 || materials < 0
    ) {
      reply.status(400);
      return { ok: false, error: "invalid_amount" };
    }

    if (food === 0 && equipment === 0 && energy === 0 && materials === 0) {
      reply.status(400);
      return { ok: false, error: "empty_contribution" };
    }

    const pool = getPool();

    await pool.query("BEGIN");

    try {
      const playerResult = await pool.query<{ home_region_id: string | null }>(
        "SELECT home_region_id FROM players WHERE client_id = $1 FOR UPDATE",
        [clientId]
      );

      const player = playerResult.rows[0];
      if (!player) {
        await pool.query("ROLLBACK");
        reply.status(404);
        return { ok: false, error: "player_not_found" };
      }

      const usageResult = await pool.query<{
        food_used: number;
        equipment_used: number;
        energy_used: number;
        materials_used: number;
      }>(
        `
        SELECT
          COALESCE(SUM((payload->>'food')::int), 0) AS food_used,
          COALESCE(SUM((payload->>'equipment')::int), 0) AS equipment_used,
          COALESCE(SUM((payload->>'energy')::int), 0) AS energy_used,
          COALESCE(SUM((payload->>'materials')::int), 0) AS materials_used
        FROM events
        WHERE event_type = 'contribute'
          AND client_id = $1
          AND region_id = $2
          AND ts > now() - interval '1 hour'
        `,
        [clientId, regionId]
      );

      const usedFood = Number(usageResult.rows[0]?.food_used ?? 0);
      const usedEquipment = Number(usageResult.rows[0]?.equipment_used ?? 0);
      const usedEnergy = Number(usageResult.rows[0]?.energy_used ?? 0);
      const usedMaterials = Number(usageResult.rows[0]?.materials_used ?? 0);
      const remainingFood = Math.max(0, CONTRIBUTION_LIMIT - usedFood);
      const remainingEquipment = Math.max(0, CONTRIBUTION_LIMIT - usedEquipment);
      const remainingEnergy = Math.max(0, CONTRIBUTION_LIMIT - usedEnergy);
      const remainingMaterials = Math.max(0, CONTRIBUTION_LIMIT - usedMaterials);

      const allowedFood = Math.min(food, remainingFood);
      const allowedEquipment = Math.min(equipment, remainingEquipment);
      const allowedEnergy = Math.min(energy, remainingEnergy);
      const allowedMaterials = Math.min(materials, remainingMaterials);

      if (allowedFood === 0 && allowedEquipment === 0 && allowedEnergy === 0 && allowedMaterials === 0) {
        await pool.query("ROLLBACK");
        reply.status(429);
        return { ok: false, error: "contribution_limit" };
      }

      const taxed = player.home_region_id && player.home_region_id !== regionId;
      const multiplier = taxed ? TAX_MULTIPLIER : 1;

      const appliedFood = Math.floor(allowedFood * multiplier);
      const appliedEquipment = Math.floor(allowedEquipment * multiplier);
      const appliedEnergy = Math.floor(allowedEnergy * multiplier);
      const appliedMaterials = Math.floor(allowedMaterials * multiplier);

      const sourceResult = sourceGersId
        ? await pool.query<{
            gers_id: string;
            h3_index: string | null;
            bbox_xmin: number | null;
            bbox_xmax: number | null;
            bbox_ymin: number | null;
            bbox_ymax: number | null;
          }>(
            `
            SELECT
              wf.gers_id,
              wfh.h3_index,
              wf.bbox_xmin,
              wf.bbox_xmax,
              wf.bbox_ymin,
              wf.bbox_ymax
            FROM world_features wf
            LEFT JOIN world_feature_hex_cells wfh ON wfh.gers_id = wf.gers_id
            WHERE wf.gers_id = $1
              AND wf.region_id = $2
              AND wf.feature_type = 'building'
            LIMIT 1
            `,
            [sourceGersId, regionId]
          )
        : null;

      if (sourceGersId && sourceResult?.rows.length === 0) {
        await pool.query("ROLLBACK");
        reply.status(400);
        return { ok: false, error: "invalid_source_gers_id" };
      }

      const fallbackSource = await pool.query<{
        gers_id: string;
        h3_index: string | null;
        bbox_xmin: number | null;
        bbox_xmax: number | null;
        bbox_ymin: number | null;
        bbox_ymax: number | null;
      }>(
        `
        SELECT
          wf.gers_id,
          wfh.h3_index,
          wf.bbox_xmin,
          wf.bbox_xmax,
          wf.bbox_ymin,
          wf.bbox_ymax
        FROM world_features AS wf
        LEFT JOIN world_feature_hex_cells wfh ON wfh.gers_id = wf.gers_id
        WHERE wf.region_id = $1
          AND wf.is_hub IS TRUE
        ORDER BY wf.created_at ASC
        LIMIT 1
        `,
        [regionId]
      );

      const source = sourceResult?.rows[0] ?? fallbackSource.rows[0];
      if (
        !source ||
        source.bbox_xmin === null ||
        source.bbox_xmax === null ||
        source.bbox_ymin === null ||
        source.bbox_ymax === null
      ) {
        await pool.query("ROLLBACK");
        reply.status(404);
        return { ok: false, error: "source_not_found" };
      }

      const sourceCenter: [number, number] = [
        (source.bbox_xmin + source.bbox_xmax) / 2,
        (source.bbox_ymin + source.bbox_ymax) / 2
      ];

      const hubResult = source.h3_index
        ? await pool.query<{
            gers_id: string;
            bbox_xmin: number | null;
            bbox_xmax: number | null;
            bbox_ymin: number | null;
            bbox_ymax: number | null;
          }>(
            `
            SELECT
              hub.gers_id,
              hub.bbox_xmin,
              hub.bbox_xmax,
              hub.bbox_ymin,
              hub.bbox_ymax
            FROM hex_cells AS h
            JOIN world_features AS hub ON hub.gers_id = h.hub_building_gers_id
            WHERE h.h3_index = $1
            `,
            [source.h3_index]
          )
        : null;

      const hub = hubResult?.rows[0] ?? fallbackSource.rows[0];
      if (
        !hub ||
        hub.bbox_xmin === null ||
        hub.bbox_xmax === null ||
        hub.bbox_ymin === null ||
        hub.bbox_ymax === null
      ) {
        await pool.query("ROLLBACK");
        reply.status(404);
        return { ok: false, error: "hub_not_found" };
      }

      const hubCenter: [number, number] = [
        (hub.bbox_xmin + hub.bbox_xmax) / 2,
        (hub.bbox_ymin + hub.bbox_ymax) / 2
      ];

      // Try A* pathfinding with road graph, fallback to haversine
      let travelSeconds: number;
      let pathWaypoints: { coord: Point; arrive_at: string }[] | null = null;
      let pathfindingDebug = "";

      const graphData = await loadGraphForRegion(regionId);
      if (graphData) {
        const { graph, coords } = graphData;
        pathfindingDebug = `region=${regionId}, connectors=${coords.size}, edges=${graph.size}`;

        const startConnector = findNearestConnector(coords, sourceCenter as Point);
        const endConnector = findNearestConnector(coords, hubCenter as Point);

        if (startConnector && endConnector) {
          // Debug: Check if connectors have edges
          const startEdges = graph.get(startConnector)?.length ?? 0;
          const endEdges = graph.get(endConnector)?.length ?? 0;
          pathfindingDebug += `, startEdges=${startEdges}, endEdges=${endEdges}`;

          const pathResult = findPath(graph, coords, startConnector, endConnector);
          if (pathResult) {
            travelSeconds = clamp(
              pathResult.totalWeightedDistance / config.RESOURCE_TRAVEL_MPS,
              config.RESOURCE_TRAVEL_MIN_S,
              config.RESOURCE_TRAVEL_MAX_S
            );

            const departAtMs = Date.now();
            pathWaypoints = buildWaypoints(
              pathResult,
              coords,
              departAtMs,
              config.RESOURCE_TRAVEL_MPS,
              {
                actualStart: sourceCenter as Point,
                actualEnd: hubCenter as Point,
              }
            );
            pathfindingDebug += `, path=${pathResult.connectorIds.length} waypoints`;
          } else {
            // No path found, fallback to haversine
            pathfindingDebug += `, NO_PATH (start=${startConnector}, end=${endConnector})`;
            const distanceMeters = haversineDistanceMeters(sourceCenter, hubCenter);
            travelSeconds = clamp(
              (distanceMeters * config.RESOURCE_DISTANCE_MULTIPLIER) / config.RESOURCE_TRAVEL_MPS,
              config.RESOURCE_TRAVEL_MIN_S,
              config.RESOURCE_TRAVEL_MAX_S
            );
          }
        } else {
          // No connectors found, fallback to haversine
          pathfindingDebug += `, NO_CONNECTORS (start=${startConnector}, end=${endConnector})`;
          const distanceMeters = haversineDistanceMeters(sourceCenter, hubCenter);
          travelSeconds = clamp(
            (distanceMeters * config.RESOURCE_DISTANCE_MULTIPLIER) / config.RESOURCE_TRAVEL_MPS,
            config.RESOURCE_TRAVEL_MIN_S,
            config.RESOURCE_TRAVEL_MAX_S
          );
        }
      } else {
        // No graph data, fallback to haversine
        pathfindingDebug = `region=${regionId}, NO_GRAPH_DATA`;
        const distanceMeters = haversineDistanceMeters(sourceCenter, hubCenter);
        travelSeconds = clamp(
          (distanceMeters * config.RESOURCE_DISTANCE_MULTIPLIER) / config.RESOURCE_TRAVEL_MPS,
          config.RESOURCE_TRAVEL_MIN_S,
          config.RESOURCE_TRAVEL_MAX_S
        );
      }

      app.log.info({ pathfindingDebug, source: source.gers_id, hub: hub.gers_id }, "pathfinding result");

      const transferRows: Array<{ type: string; amount: number }> = [];
      if (appliedFood > 0) transferRows.push({ type: "food", amount: appliedFood });
      if (appliedEquipment > 0) transferRows.push({ type: "equipment", amount: appliedEquipment });
      if (appliedEnergy > 0) transferRows.push({ type: "energy", amount: appliedEnergy });
      if (appliedMaterials > 0) transferRows.push({ type: "materials", amount: appliedMaterials });

      if (transferRows.length === 0) {
        await pool.query("ROLLBACK");
        reply.status(400);
        return { ok: false, error: "empty_contribution" };
      }

      const types = transferRows.map((row) => row.type);
      const amounts = transferRows.map((row) => row.amount);

      const transferResult = await pool.query<{
        transfer_id: string;
        region_id: string;
        source_gers_id: string | null;
        hub_gers_id: string | null;
        resource_type: "food" | "equipment" | "energy" | "materials";
        amount: number;
        depart_at: string;
        arrive_at: string;
        path_waypoints: { coord: Point; arrive_at: string }[] | null;
      }>(
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
        SELECT
          $1,
          $2,
          $3,
          resource_type,
          amount,
          now(),
          now() + ($4 || ' seconds')::interval,
          $7::jsonb
        FROM UNNEST($5::text[], $6::int[]) AS t(resource_type, amount)
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
          regionId,
          source.gers_id,
          hub.gers_id,
          travelSeconds,
          types,
          amounts,
          pathWaypoints ? JSON.stringify(pathWaypoints) : null
        ]
      );

      await pool.query(
        "UPDATE players SET lifetime_contrib = lifetime_contrib + $2, last_seen = now() WHERE client_id = $1",
        [clientId, appliedFood + appliedEquipment + appliedEnergy + appliedMaterials]
      );

      await pool.query(
        "INSERT INTO events (event_type, client_id, region_id, payload) VALUES ('contribute', $1, $2, $3::jsonb)",
        [
          clientId,
          regionId,
          JSON.stringify({
            food: allowedFood,
            equipment: allowedEquipment,
            energy: allowedEnergy,
            materials: allowedMaterials,
            applied_food: appliedFood,
            applied_equipment: appliedEquipment,
            applied_energy: appliedEnergy,
            applied_materials: appliedMaterials,
            taxed,
            source_gers_id: source.gers_id,
            hub_gers_id: hub.gers_id
          })
        ]
      );

      for (const transfer of transferResult.rows) {
        await pool.query("SELECT pg_notify($1, $2)", [
          "resource_transfer",
          JSON.stringify(transfer)
        ]);
      }

      // Activate the building so it continues auto-generating resources
      if (sourceGersId) {
        await pool.query(
          `INSERT INTO feature_state (gers_id, last_activated_at)
           VALUES ($1, now())
           ON CONFLICT (gers_id) DO UPDATE SET last_activated_at = now()`,
          [sourceGersId]
        );
      }

      // Award contribution score (1 point per resource unit)
      const totalContributed = appliedFood + appliedEquipment + appliedEnergy + appliedMaterials;
      const scoreAmount = totalContributed * SCORE_ACTIONS.resourceContribution;
      const scoreResult = await awardPlayerScore(pool, clientId, "contribution", scoreAmount, regionId, source.gers_id);

      await pool.query("COMMIT");

      return {
        ok: true,
        applied_food: appliedFood,
        applied_equipment: appliedEquipment,
        applied_energy: appliedEnergy,
        applied_materials: appliedMaterials,
        remaining_food: Math.max(0, remainingFood - allowedFood),
        remaining_equipment: Math.max(0, remainingEquipment - allowedEquipment),
        remaining_energy: Math.max(0, remainingEnergy - allowedEnergy),
        remaining_materials: Math.max(0, remainingMaterials - allowedMaterials),
        transfers: transferResult.rows,
        score_awarded: scoreResult ? scoreAmount : 0,
        new_total_score: scoreResult?.newScore ?? null,
        new_tier: scoreResult?.tier ?? null
      };
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  });
}
