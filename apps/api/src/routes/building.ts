/**
 * Building routes: activate
 */

import type { FastifyInstance } from "fastify";
import { getPool } from "../db";
import { verifyToken } from "../utils/auth";
import { BUILDING_ACTIVATION_MS } from "../utils/constants";

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

    return {
      ok: true,
      already_activated: false,
      activated_at: activatedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    };
  });
}
