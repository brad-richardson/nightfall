/**
 * Admin routes for demo mode, reset, and configuration
 */

import type { FastifyInstance } from "fastify";
import type { RouteContext } from "./types";
import { getPool } from "../db";
import { verifyAdminSecret } from "../utils/auth";
import { PHASE_DURATIONS, getNextPhase, type Phase } from "../utils/phase";
import { MAX_RESOURCE_VALUE } from "../utils/constants";

export function registerAdminRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { config } = ctx;

  app.post("/api/admin/demo-mode", {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const authHeader = request.headers["authorization"];

    if (!verifyAdminSecret(authHeader, config.ADMIN_SECRET)) {
      reply.status(401);
      return { ok: false, error: "unauthorized" };
    }

    const body = request.body as {
      enabled: boolean;
      tick_multiplier?: number;
      cycle_speed?: number;
    };

    const pool = getPool();
    await pool.query(
      `
      INSERT INTO world_meta (key, value, updated_at)
      VALUES ('demo_mode', $1, now())
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = now()
      `,
      [JSON.stringify({
        enabled: body.enabled,
        tick_multiplier: body.tick_multiplier ?? 1,
        cycle_speed: body.cycle_speed ?? 1
      })]
    );

    return { ok: true };
  });

  app.post("/api/admin/reset", {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const authHeader = request.headers["authorization"];

    if (!verifyAdminSecret(authHeader, config.ADMIN_SECRET)) {
      reply.status(401);
      return { ok: false, error: "unauthorized" };
    }

    const pool = getPool();
    // Signal a pending reset to the ticker via world_meta
    await pool.query(
      `
      INSERT INTO world_meta (key, value, updated_at)
      VALUES ('pending_reset', 'true'::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = now()
      `
    );

    return { ok: true, message: "reset_scheduled" };
  });

  // Set resource pools directly (admin only)
  app.post("/api/admin/set-resources", {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const authHeader = request.headers["authorization"];

    if (!verifyAdminSecret(authHeader, config.ADMIN_SECRET)) {
      reply.status(401);
      return { ok: false, error: "unauthorized" };
    }

    const body = request.body as {
      region_id?: string;
      food?: number;
      equipment?: number;
      energy?: number;
      materials?: number;
    };

    if (!body.region_id) {
      reply.status(400);
      return { ok: false, error: "region_id_required" };
    }

    const pool = getPool();

    const updates: string[] = [];
    const values: (string | number)[] = [body.region_id];
    let paramIndex = 2;

    if (body.food !== undefined && Number.isFinite(body.food) && body.food >= 0 && body.food <= MAX_RESOURCE_VALUE) {
      updates.push(`pool_food = $${paramIndex++}`);
      values.push(body.food);
    }
    if (body.equipment !== undefined && Number.isFinite(body.equipment) && body.equipment >= 0 && body.equipment <= MAX_RESOURCE_VALUE) {
      updates.push(`pool_equipment = $${paramIndex++}`);
      values.push(body.equipment);
    }
    if (body.energy !== undefined && Number.isFinite(body.energy) && body.energy >= 0 && body.energy <= MAX_RESOURCE_VALUE) {
      updates.push(`pool_energy = $${paramIndex++}`);
      values.push(body.energy);
    }
    if (body.materials !== undefined && Number.isFinite(body.materials) && body.materials >= 0 && body.materials <= MAX_RESOURCE_VALUE) {
      updates.push(`pool_materials = $${paramIndex++}`);
      values.push(body.materials);
    }

    if (updates.length === 0) {
      reply.status(400);
      return { ok: false, error: "no_valid_updates" };
    }

    const updateResult = await pool.query<{
      pool_food: number;
      pool_equipment: number;
      pool_energy: number;
      pool_materials: number;
    }>(
      `UPDATE regions SET ${updates.join(", ")} WHERE region_id = $1 RETURNING pool_food::float, pool_equipment::float, pool_energy::float, pool_materials::float`,
      values
    );

    if (updateResult.rowCount === 0) {
      reply.status(404);
      return { ok: false, error: "region_not_found" };
    }

    // Notify clients of resource change
    await pool.query("SELECT pg_notify('world_delta', $1)", [
      JSON.stringify({
        type: "region_resources",
        region_id: body.region_id,
        ...updateResult.rows[0]
      })
    ]);

    return { ok: true };
  });

  // Set cycle phase directly (admin only)
  app.post("/api/admin/set-phase", {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const authHeader = request.headers["authorization"];

    if (!verifyAdminSecret(authHeader, config.ADMIN_SECRET)) {
      reply.status(401);
      return { ok: false, error: "unauthorized" };
    }

    const body = request.body as { phase?: string };
    const validPhases: Phase[] = ["dawn", "day", "dusk", "night"];

    if (!body.phase || !validPhases.includes(body.phase as Phase)) {
      reply.status(400);
      return { ok: false, error: "invalid_phase" };
    }

    const phase = body.phase as Phase;
    const pool = getPool();
    const nextPhase = getNextPhase(phase);

    await pool.query(
      `
      INSERT INTO world_meta (key, value, updated_at)
      VALUES ('cycle_state', $1, now())
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = now()
      `,
      [JSON.stringify({
        phase,
        phase_start: new Date().toISOString(),
        phase_duration_s: PHASE_DURATIONS[phase]
      })]
    );

    // Notify clients of phase change
    await pool.query("SELECT pg_notify('phase_change', $1)", [
      JSON.stringify({
        phase,
        phase_progress: 0,
        next_phase: nextPhase,
        next_phase_in_seconds: PHASE_DURATIONS[phase]
      })
    ]);

    return { ok: true };
  });

  // Set road health for all roads in a region (admin only)
  app.post("/api/admin/set-road-health", {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const authHeader = request.headers["authorization"];

    if (!verifyAdminSecret(authHeader, config.ADMIN_SECRET)) {
      reply.status(401);
      return { ok: false, error: "unauthorized" };
    }

    const body = request.body as { region_id?: string; health?: number };

    if (!body.region_id) {
      reply.status(400);
      return { ok: false, error: "region_id_required" };
    }

    if (body.health === undefined || !Number.isFinite(body.health) || body.health < 0 || body.health > 100) {
      reply.status(400);
      return { ok: false, error: "invalid_health" };
    }

    const pool = getPool();

    const updateResult = await pool.query(
      `
      UPDATE feature_state fs
      SET health = $2
      FROM world_features wf
      WHERE fs.gers_id = wf.gers_id
        AND wf.region_id = $1
        AND wf.feature_type = 'road'
      `,
      [body.region_id, body.health]
    );

    if (updateResult.rowCount === 0) {
      reply.status(404);
      return { ok: false, error: "no_roads_found" };
    }

    // Notify clients of feature changes
    await pool.query("SELECT pg_notify('world_delta', $1)", [
      JSON.stringify({
        type: "road_health_bulk",
        region_id: body.region_id,
        health: body.health
      })
    ]);

    return { ok: true, roads_updated: updateResult.rowCount };
  });

  // Set rust level for all hexes in a region (admin only)
  app.post("/api/admin/set-rust", {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const authHeader = request.headers["authorization"];

    if (!verifyAdminSecret(authHeader, config.ADMIN_SECRET)) {
      reply.status(401);
      return { ok: false, error: "unauthorized" };
    }

    const body = request.body as { region_id?: string; rust_level?: number };

    if (!body.region_id) {
      reply.status(400);
      return { ok: false, error: "region_id_required" };
    }

    if (body.rust_level === undefined || !Number.isFinite(body.rust_level) || body.rust_level < 0 || body.rust_level > 1) {
      reply.status(400);
      return { ok: false, error: "invalid_rust_level" };
    }

    const pool = getPool();

    const updateResult = await pool.query(
      `UPDATE hex_cells SET rust_level = $2 WHERE region_id = $1`,
      [body.region_id, body.rust_level]
    );

    if (updateResult.rowCount === 0) {
      reply.status(404);
      return { ok: false, error: "no_hexes_found" };
    }

    // Notify clients of hex changes
    const notifyPayload = JSON.stringify({
      type: "rust_bulk",
      region_id: body.region_id,
      rust_level: body.rust_level
    });
    app.log.info({ payload: notifyPayload }, "Sending rust_bulk notification via pg_notify");
    await pool.query("SELECT pg_notify('world_delta', $1)", [notifyPayload]);

    return { ok: true, hexes_updated: updateResult.rowCount };
  });

  // Fix orphaned 'active' tasks (admin only)
  app.post("/api/admin/fix-orphaned-tasks", {
    schema: {
      body: {
        type: "object",
        required: ["secret"],
        properties: {
          secret: { type: "string" }
        }
      }
    }
  }, async (request, reply) => {
    const body = request.body as { secret: string };
    if (body.secret !== process.env.ADMIN_SECRET) {
      reply.status(401);
      return { ok: false, error: "unauthorized" };
    }

    const pool = getPool();

    // Reset orphaned 'active' tasks back to 'queued'
    const result = await pool.query(
      `UPDATE tasks
       SET status = 'queued'
       WHERE status = 'active'
         AND task_id NOT IN (SELECT active_task_id FROM crews WHERE active_task_id IS NOT NULL)`
    );

    return { ok: true, tasks_fixed: result.rowCount };
  });
}
