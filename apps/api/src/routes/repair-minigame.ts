/**
 * Repair minigame routes: start, complete, abandon
 * Allows players to manually repair roads through minigames
 */

import type { FastifyInstance } from "fastify";
import { getPool } from "../db";
import { loadCycleState } from "../cycle";
import { verifyToken } from "../utils/auth";
import { awardPlayerScore } from "../services/score";
import {
  REPAIR_MINIGAME_TYPES,
  REPAIR_MINIGAME_CONFIG,
  REPAIR_SUCCESS_THRESHOLD,
} from "../utils/constants";
import { SCORE_ACTIONS } from "@nightfall/config";

/**
 * Calculate extra rounds based on how much health needs to be restored.
 * More damage = longer game (more rounds).
 * Base rounds + up to 5 extra rounds for severely damaged roads.
 */
function calculateExtraRoundsFromDamage(currentHealth: number): number {
  const damage = 100 - currentHealth;
  // 0-20 damage: 0 extra rounds
  // 21-40 damage: 1 extra round
  // 41-60 damage: 2 extra rounds
  // 61-80 damage: 3 extra rounds
  // 81-100 damage: 5 extra rounds
  if (damage <= 20) return 0;
  if (damage <= 40) return 1;
  if (damage <= 60) return 2;
  if (damage <= 80) return 3;
  return 5;
}

/**
 * Calculate health restoration based on performance.
 * Better performance = more health restored.
 */
function calculateHealthRestoration(
  score: number,
  maxScore: number,
  currentHealth: number
): { newHealth: number; restored: number; success: boolean } {
  const performance = Math.min(1, score / maxScore);
  const success = performance >= REPAIR_SUCCESS_THRESHOLD;

  if (!success) {
    // Failed repair - restore minimal health (10% of damage)
    const damage = 100 - currentHealth;
    const restored = Math.round(damage * 0.1);
    return {
      newHealth: Math.min(100, currentHealth + restored),
      restored,
      success: false,
    };
  }

  // Successful repair - restore based on performance
  // Formula: restorePercent = 0.5 + (performance * 0.5)
  // 60% performance = 80% of remaining damage restored
  // 100% performance = 100% of damage restored (full heal)
  const damage = 100 - currentHealth;
  const restorePercent = 0.5 + (performance * 0.5); // 50%-100% of damage
  const restored = Math.round(damage * restorePercent);

  return {
    newHealth: Math.min(100, currentHealth + restored),
    restored,
    success: true,
  };
}

export function registerRepairMinigameRoutes(app: FastifyInstance) {
  app.post("/api/repair-minigame/start", async (request, reply) => {
    const body = request.body as {
      client_id?: string;
      road_gers_id?: string;
    } | undefined;

    const clientId = body?.client_id?.trim();
    const roadGersId = body?.road_gers_id?.trim();
    const authHeader = request.headers["authorization"];

    if (!clientId || !roadGersId) {
      reply.status(400);
      return { ok: false, error: "client_id_and_road_required" };
    }

    if (!authHeader || !verifyToken(clientId, authHeader)) {
      reply.status(401);
      return { ok: false, error: "unauthorized" };
    }

    const pool = getPool();

    // Check if road exists and get its current health
    const roadResult = await pool.query<{
      gers_id: string;
      road_class: string;
      h3_index: string | null;
    }>(
      `
      SELECT wf.gers_id, wf.road_class, wfh.h3_index
      FROM world_features wf
      LEFT JOIN world_feature_hex_cells wfh ON wfh.gers_id = wf.gers_id
      WHERE wf.gers_id = $1 AND wf.feature_type = 'road'
      `,
      [roadGersId]
    );

    const road = roadResult.rows[0];
    if (!road) {
      reply.status(404);
      return { ok: false, error: "road_not_found" };
    }

    // Get current health from feature_state
    const healthResult = await pool.query<{ health: number }>(
      "SELECT health FROM feature_state WHERE gers_id = $1",
      [roadGersId]
    );
    const currentHealth = healthResult.rows[0]?.health ?? 100;

    // Don't allow repair if already at 100%
    if (currentHealth >= 100) {
      reply.status(400);
      return { ok: false, error: "road_already_healthy" };
    }

    // Check if there's already an active repair session for this road
    const existingSession = await pool.query<{ session_id: string }>(
      `SELECT session_id FROM repair_minigame_sessions
       WHERE road_gers_id = $1 AND status = 'active'`,
      [roadGersId]
    );

    if (existingSession.rows.length > 0) {
      reply.status(409);
      return { ok: false, error: "repair_already_in_progress" };
    }

    // Get current cycle phase for difficulty scaling
    const cycleState = await loadCycleState(pool);
    const phase = cycleState.phase;

    // Get rust level at road location
    let rustLevel = 0;
    if (road.h3_index) {
      const rustResult = await pool.query<{ rust_level: number }>(
        "SELECT rust_level FROM hex_cells WHERE h3_index = $1",
        [road.h3_index]
      );
      rustLevel = rustResult.rows[0]?.rust_level ?? 0;
    }

    // Select a random repair minigame
    const selectedMinigame = REPAIR_MINIGAME_TYPES[
      Math.floor(Math.random() * REPAIR_MINIGAME_TYPES.length)
    ];
    const config = REPAIR_MINIGAME_CONFIG[selectedMinigame];

    // Calculate difficulty modifiers
    const isNight = phase === "night";
    const isHighRust = rustLevel > 0.5;
    const speedMult = 1 + (isNight ? 0.25 : 0) + (isHighRust ? 0.1 : 0);
    const windowMult = 1 - (isNight ? 0.2 : 0) - (isHighRust ? 0.1 : 0);

    // Extra rounds based on damage level (more damage = longer game)
    const damageExtraRounds = calculateExtraRoundsFromDamage(currentHealth);
    const nightExtraRounds = isNight ? 2 : 0;
    const extraRounds = damageExtraRounds + nightExtraRounds;

    const difficulty = {
      speed_mult: speedMult,
      window_mult: windowMult,
      extra_rounds: extraRounds,
      rust_level: rustLevel,
      phase,
    };

    // Create repair minigame session
    const sessionResult = await pool.query<{ session_id: string }>(
      `
      INSERT INTO repair_minigame_sessions (
        client_id, road_gers_id, minigame_type, difficulty,
        max_possible_score, expected_duration_ms, current_health
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING session_id
      `,
      [
        clientId,
        roadGersId,
        selectedMinigame,
        JSON.stringify(difficulty),
        config.maxScore,
        config.expectedDurationMs,
        currentHealth,
      ]
    );

    const sessionId = sessionResult.rows[0].session_id;

    return {
      ok: true,
      session_id: sessionId,
      minigame_type: selectedMinigame,
      road_class: road.road_class,
      current_health: currentHealth,
      target_health: 100,
      config: {
        base_rounds: config.baseRounds + extraRounds,
        max_score: config.maxScore,
        expected_duration_ms: config.expectedDurationMs,
      },
      difficulty,
    };
  });

  app.post("/api/repair-minigame/complete", async (request, reply) => {
    const body = request.body as {
      client_id?: string;
      session_id?: string;
      score?: number;
      duration_ms?: number;
    } | undefined;

    const clientId = body?.client_id?.trim();
    const sessionId = body?.session_id?.trim();
    const score = Number(body?.score ?? 0);
    const durationMs = Number(body?.duration_ms ?? 0);
    const authHeader = request.headers["authorization"];

    if (!clientId || !sessionId) {
      reply.status(400);
      return { ok: false, error: "client_id_and_session_required" };
    }

    if (!authHeader || !verifyToken(clientId, authHeader)) {
      reply.status(401);
      return { ok: false, error: "unauthorized" };
    }

    if (!Number.isFinite(score) || score < 0) {
      reply.status(400);
      return { ok: false, error: "invalid_score" };
    }

    const pool = getPool();

    // Verify session exists and belongs to this client
    const sessionResult = await pool.query<{
      session_id: string;
      client_id: string;
      road_gers_id: string;
      minigame_type: string;
      difficulty: { phase: string };
      max_possible_score: number;
      expected_duration_ms: number;
      status: string;
      current_health: number;
      started_at: Date;
    }>(
      `SELECT * FROM repair_minigame_sessions WHERE session_id = $1`,
      [sessionId]
    );

    const session = sessionResult.rows[0];
    if (!session) {
      reply.status(404);
      return { ok: false, error: "session_not_found" };
    }

    if (session.client_id !== clientId) {
      reply.status(403);
      return { ok: false, error: "session_not_yours" };
    }

    if (session.status !== "active") {
      reply.status(400);
      return { ok: false, error: "session_already_completed" };
    }

    // Anti-cheat: validate score and duration
    if (score > session.max_possible_score) {
      reply.status(400);
      return { ok: false, error: "score_exceeds_maximum" };
    }

    const minDurationMs = session.expected_duration_ms * 0.3;
    if (durationMs < minDurationMs) {
      reply.status(400);
      return { ok: false, error: "duration_too_fast" };
    }

    // Calculate health restoration based on performance
    const result = calculateHealthRestoration(
      score,
      session.max_possible_score,
      session.current_health
    );
    const performance = Math.min(1, score / session.max_possible_score);

    await pool.query("BEGIN");

    try {
      // Mark session as completed
      await pool.query(
        `UPDATE repair_minigame_sessions
         SET status = $1, completed_at = now(), final_score = $2
         WHERE session_id = $3`,
        [result.success ? "completed" : "failed", score, sessionId]
      );

      // Update road health
      await pool.query(
        `INSERT INTO feature_state (gers_id, health, status, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (gers_id) DO UPDATE SET
           health = EXCLUDED.health,
           status = CASE
             WHEN EXCLUDED.health >= 70 THEN 'normal'
             ELSE 'degraded'
           END,
           updated_at = now()`,
        [session.road_gers_id, result.newHealth, result.newHealth >= 70 ? 'normal' : 'degraded']
      );

      // If road is now healthy, mark any queued tasks for this road as done
      // (since manual repair has fixed it)
      if (result.newHealth >= 70) {
        const taskResult = await pool.query<{ task_id: string; region_id: string }>(
          `UPDATE tasks
           SET status = 'done', completed_at = now()
           WHERE target_gers_id = $1 AND status = 'queued'
           RETURNING task_id, region_id`,
          [session.road_gers_id]
        );

        // Emit task delta for any tasks that were marked done
        for (const task of taskResult.rows) {
          await pool.query("SELECT pg_notify($1, $2)", [
            "task_delta",
            JSON.stringify({
              tasks: [{
                task_id: task.task_id,
                status: 'done',
                region_id: task.region_id,
                target_gers_id: session.road_gers_id
              }]
            }),
          ]);
        }
      }

      // Emit feature delta for UI update (ID-only format, client fetches full data)
      await pool.query("SELECT pg_notify($1, $2)", [
        "feature_delta",
        JSON.stringify({ feature_ids: [session.road_gers_id] }),
      ]);

      // Award score for repair attempt
      const roadRegion = await pool.query<{ region_id: string }>(
        "SELECT region_id FROM world_features WHERE gers_id = $1",
        [session.road_gers_id]
      );
      const regionId = roadRegion.rows[0]?.region_id;

      // Base score for attempting, bonus for success
      const scoreAmount = result.success
        ? SCORE_ACTIONS.minigameCompleted + (performance >= 0.9 ? SCORE_ACTIONS.minigamePerfect : 0)
        : Math.round(SCORE_ACTIONS.minigameCompleted * 0.5);

      const playerScoreResult = await awardPlayerScore(
        pool,
        clientId,
        "minigame",
        scoreAmount,
        regionId,
        sessionId
      );

      await pool.query("COMMIT");

      return {
        ok: true,
        success: result.success,
        performance: Math.round(performance * 100),
        new_health: result.newHealth,
        health_restored: result.restored,
        score_awarded: scoreAmount,
        new_total_score: playerScoreResult?.newScore ?? null,
        new_tier: playerScoreResult?.tier ?? null,
      };
    } catch (err) {
      await pool.query("ROLLBACK");
      throw err;
    }
  });

  app.post("/api/repair-minigame/abandon", async (request, reply) => {
    const body = request.body as {
      client_id?: string;
      session_id?: string;
    } | undefined;

    const clientId = body?.client_id?.trim();
    const sessionId = body?.session_id?.trim();
    const authHeader = request.headers["authorization"];

    if (!clientId || !sessionId) {
      reply.status(400);
      return { ok: false, error: "client_id_and_session_required" };
    }

    if (!authHeader || !verifyToken(clientId, authHeader)) {
      reply.status(401);
      return { ok: false, error: "unauthorized" };
    }

    const pool = getPool();

    // Verify session exists and belongs to this client
    const sessionResult = await pool.query<{ client_id: string; status: string }>(
      `SELECT client_id, status FROM repair_minigame_sessions WHERE session_id = $1`,
      [sessionId]
    );

    const session = sessionResult.rows[0];
    if (!session) {
      reply.status(404);
      return { ok: false, error: "session_not_found" };
    }

    if (session.client_id !== clientId) {
      reply.status(403);
      return { ok: false, error: "session_not_yours" };
    }

    if (session.status !== "active") {
      reply.status(400);
      return { ok: false, error: "session_already_completed" };
    }

    // Mark session as abandoned
    await pool.query(
      `UPDATE repair_minigame_sessions SET status = 'abandoned', completed_at = now() WHERE session_id = $1`,
      [sessionId]
    );

    return { ok: true };
  });
}
