/**
 * Minigame routes: start, complete, abandon
 */

import type { FastifyInstance } from "fastify";
import { getPool } from "../db";
import { loadCycleState } from "../cycle";
import { verifyToken } from "../utils/auth";
import { awardPlayerScore } from "../services/score";
import {
  MINIGAME_COOLDOWN_MS,
  BASE_BOOST_DURATION_MS,
  BUILDING_ACTIVATION_MS,
  QUICK_MODE_ROUNDS,
  FOOD_MINIGAMES,
  EQUIPMENT_MINIGAMES,
  ENERGY_MINIGAMES,
  MATERIALS_MINIGAMES,
  MINIGAME_CONFIG,
  type MinigameMode
} from "../utils/constants";
import { SCORE_ACTIONS } from "@nightfall/config";

function calculateMinigameReward(score: number, maxScore: number, phase: string) {
  const performance = Math.min(1, score / maxScore);
  const multiplier = 1.5 + (performance * 1.5); // 2.25x at 50%, up to 3x at 100%
  const durationMs = BASE_BOOST_DURATION_MS * (0.33 + performance * 1.67);
  const nightBonus = phase === "night" ? 1.2 : 1.0;

  return {
    multiplier: Math.round(multiplier * 10) / 10,
    durationMs: Math.round(durationMs * nightBonus),
  };
}

function getMinigamesForBuilding(building: { generates_food?: boolean; generates_equipment?: boolean; generates_energy?: boolean; generates_materials?: boolean }) {
  if (building.generates_food) return FOOD_MINIGAMES;
  if (building.generates_equipment) return EQUIPMENT_MINIGAMES;
  if (building.generates_energy) return ENERGY_MINIGAMES;
  if (building.generates_materials) return MATERIALS_MINIGAMES;
  return [];
}

function getResourceTypeForBuilding(building: { generates_food?: boolean; generates_equipment?: boolean; generates_energy?: boolean; generates_materials?: boolean }) {
  if (building.generates_food) return "food";
  if (building.generates_equipment) return "equipment";
  if (building.generates_energy) return "energy";
  if (building.generates_materials) return "materials";
  return null;
}

export function registerMinigameRoutes(app: FastifyInstance) {
  app.post("/api/minigame/start", async (request, reply) => {
    const body = request.body as {
      client_id?: string;
      building_gers_id?: string;
      mode?: MinigameMode;
    } | undefined;

    const clientId = body?.client_id?.trim();
    const buildingGersId = body?.building_gers_id?.trim();
    const mode: MinigameMode = body?.mode === "quick" ? "quick" : "boost";
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
      h3_index: string | null;
    }>(
      `
      SELECT wf.gers_id, wf.generates_food, wf.generates_equipment,
             wf.generates_energy, wf.generates_materials, wfh.h3_index
      FROM world_features wf
      LEFT JOIN world_feature_hex_cells wfh ON wfh.gers_id = wf.gers_id
      WHERE wf.gers_id = $1 AND wf.feature_type = 'building'
      `,
      [buildingGersId]
    );

    const building = buildingResult.rows[0];
    if (!building) {
      reply.status(404);
      return { ok: false, error: "building_not_found" };
    }

    const availableMinigames = getMinigamesForBuilding(building);
    if (availableMinigames.length === 0) {
      reply.status(400);
      return { ok: false, error: "building_not_resource_generating" };
    }

    // Check cooldown
    const cooldownResult = await pool.query<{ available_at: Date }>(
      `SELECT available_at FROM minigame_cooldowns
       WHERE client_id = $1 AND building_gers_id = $2`,
      [clientId, buildingGersId]
    );

    if (cooldownResult.rows.length > 0) {
      const availableAt = new Date(cooldownResult.rows[0].available_at);
      if (availableAt > new Date()) {
        reply.status(429);
        return {
          ok: false,
          error: "cooldown_active",
          available_at: availableAt.toISOString(),
          cooldown_remaining_ms: availableAt.getTime() - Date.now(),
        };
      }
    }

    // Get current cycle phase for difficulty scaling
    const cycleState = await loadCycleState(pool);
    const phase = cycleState.phase;

    // Get rust level at building location
    let rustLevel = 0;
    if (building.h3_index) {
      const rustResult = await pool.query<{ rust_level: number }>(
        "SELECT rust_level FROM hex_cells WHERE h3_index = $1",
        [building.h3_index]
      );
      rustLevel = rustResult.rows[0]?.rust_level ?? 0;
    }

    // Select a random minigame for this resource type
    const selectedMinigame = availableMinigames[Math.floor(Math.random() * availableMinigames.length)];
    const config = MINIGAME_CONFIG[selectedMinigame];

    // Calculate difficulty modifiers (only apply extra difficulty for boost mode)
    const isNight = phase === "night";
    const isHighRust = rustLevel > 0.5;
    const speedMult = mode === "quick" ? 1 : 1 + (isNight ? 0.25 : 0) + (isHighRust ? 0.1 : 0);
    const windowMult = mode === "quick" ? 1 : 1 - (isNight ? 0.2 : 0) - (isHighRust ? 0.1 : 0);
    const extraRounds = mode === "quick" ? 0 : (isNight ? 2 : 0);

    // Quick mode uses 1 round; boost mode uses full rounds
    const effectiveRounds = mode === "quick" ? QUICK_MODE_ROUNDS : config.baseRounds + extraRounds;

    // Scale expected duration and max score for quick mode
    const roundRatio = effectiveRounds / config.baseRounds;
    const effectiveMaxScore = mode === "quick"
      ? Math.round(config.maxScore * roundRatio)
      : config.maxScore;
    const effectiveExpectedDuration = mode === "quick"
      ? Math.round(config.expectedDurationMs * roundRatio * 0.5) // Quick mode is faster per round too
      : config.expectedDurationMs;

    const difficulty = {
      speed_mult: speedMult,
      window_mult: windowMult,
      extra_rounds: extraRounds,
      rust_level: rustLevel,
      phase,
      mode, // Include mode in difficulty for completion handler
    };

    // Create minigame session
    const sessionResult = await pool.query<{ session_id: string }>(
      `
      INSERT INTO minigame_sessions (
        client_id, building_gers_id, minigame_type, difficulty,
        max_possible_score, expected_duration_ms
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING session_id
      `,
      [
        clientId,
        buildingGersId,
        selectedMinigame,
        JSON.stringify(difficulty),
        effectiveMaxScore,
        effectiveExpectedDuration,
      ]
    );

    const sessionId = sessionResult.rows[0].session_id;

    return {
      ok: true,
      session_id: sessionId,
      minigame_type: selectedMinigame,
      resource_type: getResourceTypeForBuilding(building),
      mode,
      config: {
        base_rounds: effectiveRounds,
        max_score: effectiveMaxScore,
        expected_duration_ms: effectiveExpectedDuration,
      },
      difficulty,
    };
  });

  app.post("/api/minigame/complete", async (request, reply) => {
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
      building_gers_id: string;
      minigame_type: string;
      difficulty: { phase: string; mode?: MinigameMode };
      max_possible_score: number;
      expected_duration_ms: number;
      status: string;
      started_at: Date;
    }>(
      `SELECT * FROM minigame_sessions WHERE session_id = $1`,
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

    const minDurationMs = session.expected_duration_ms * 0.3; // Allow 30% faster than expected
    if (durationMs < minDurationMs) {
      reply.status(400);
      return { ok: false, error: "duration_too_fast" };
    }

    // Determine if this is quick mode (activation only) or boost mode
    const isQuickMode = session.difficulty.mode === "quick";

    // Calculate reward (only used for boost mode, but we still need performance for scoring)
    const reward = calculateMinigameReward(score, session.max_possible_score, session.difficulty.phase);
    const expiresAt = new Date(Date.now() + reward.durationMs);
    // Quick mode has no cooldown since it's just a simple activation
    const cooldownAt = isQuickMode ? null : new Date(Date.now() + MINIGAME_COOLDOWN_MS);

    await pool.query("BEGIN");

    try {
      // Mark session as completed
      await pool.query(
        `UPDATE minigame_sessions SET status = 'completed', completed_at = now() WHERE session_id = $1`,
        [sessionId]
      );

      const now = new Date();
      let finalMultiplier: number | null = null;
      let finalExpiresAt: Date | null = null;
      let shouldUpdateBoost = false;

      // Only apply boost for boost mode
      if (!isQuickMode) {
        // Check existing boost - only update if new multiplier is higher
        const existingBoostResult = await pool.query<{ multiplier: number; expires_at: Date }>(
          `SELECT multiplier, expires_at FROM production_boosts WHERE building_gers_id = $1`,
          [session.building_gers_id]
        );

        const existingBoost = existingBoostResult.rows[0];
        const existingBoostActive = existingBoost && new Date(existingBoost.expires_at) > now;
        // Only update boost if new multiplier is strictly higher to preserve existing boost timing
        shouldUpdateBoost = !existingBoostActive || reward.multiplier > existingBoost.multiplier;

        finalMultiplier = reward.multiplier;
        finalExpiresAt = expiresAt;

        if (shouldUpdateBoost) {
          // Upsert production boost (one active boost per building)
          await pool.query(
            `
            INSERT INTO production_boosts (
              building_gers_id, client_id, multiplier, expires_at, minigame_type, score, session_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (building_gers_id) DO UPDATE SET
              client_id = EXCLUDED.client_id,
              multiplier = EXCLUDED.multiplier,
              started_at = now(),
              expires_at = EXCLUDED.expires_at,
              minigame_type = EXCLUDED.minigame_type,
              score = EXCLUDED.score,
              session_id = EXCLUDED.session_id,
              created_at = now()
            `,
            [session.building_gers_id, clientId, reward.multiplier, expiresAt, session.minigame_type, score, sessionId]
          );
        } else {
          // Keep existing boost
          finalMultiplier = existingBoost.multiplier;
          finalExpiresAt = existingBoost.expires_at;
        }

        // Set cooldown (boost mode only)
        await pool.query(
          `
          INSERT INTO minigame_cooldowns (client_id, building_gers_id, available_at)
          VALUES ($1, $2, $3)
          ON CONFLICT (client_id, building_gers_id) DO UPDATE SET available_at = EXCLUDED.available_at
          `,
          [clientId, session.building_gers_id, cooldownAt]
        );

        // Emit SSE event for boost via pg_notify (boost mode only)
        await pool.query("SELECT pg_notify($1, $2)", [
          "building_boost",
          JSON.stringify({
            building_gers_id: session.building_gers_id,
            multiplier: finalMultiplier,
            expires_at: finalExpiresAt instanceof Date ? finalExpiresAt.toISOString() : finalExpiresAt,
            client_id: clientId,
            minigame_type: session.minigame_type,
            boost_updated: shouldUpdateBoost,
          })
        ]);
      }

      // Always activate the building (set last_activated_at) - this triggers convoy deliveries
      const activationExpiresAt = new Date(now.getTime() + BUILDING_ACTIVATION_MS);
      await pool.query(
        `INSERT INTO feature_state (gers_id, last_activated_at)
         VALUES ($1, now())
         ON CONFLICT (gers_id) DO UPDATE SET last_activated_at = now()`,
        [session.building_gers_id]
      );

      // Emit building activation event
      await pool.query("SELECT pg_notify($1, $2)", [
        "building_activation",
        JSON.stringify({
          building_gers_id: session.building_gers_id,
          activated_at: now.toISOString(),
          expires_at: activationExpiresAt.toISOString(),
          client_id: clientId,
        })
      ]);

      // Award minigame score (base + perfect bonus)
      const performance = score / session.max_possible_score;
      const isPerfect = performance >= 0.99; // Allow 1% margin for floating point
      const minigameScoreAmount = SCORE_ACTIONS.minigameCompleted + (isPerfect ? SCORE_ACTIONS.minigamePerfect : 0);

      // Get building's region for the score event
      const buildingRegion = await pool.query<{ region_id: string }>(
        "SELECT region_id FROM world_features WHERE gers_id = $1",
        [session.building_gers_id]
      );
      const regionId = buildingRegion.rows[0]?.region_id;

      const playerScoreResult = await awardPlayerScore(
        pool,
        clientId,
        "minigame",
        minigameScoreAmount,
        regionId,
        sessionId
      );

      await pool.query("COMMIT");

      return {
        ok: true,
        mode: isQuickMode ? "quick" : "boost",
        // Reward is only present for boost mode
        reward: isQuickMode ? null : {
          multiplier: finalMultiplier,
          duration_ms: reward.durationMs,
          expires_at: finalExpiresAt instanceof Date ? finalExpiresAt.toISOString() : finalExpiresAt,
        },
        boost_updated: shouldUpdateBoost,
        activation: {
          activated_at: now.toISOString(),
          expires_at: activationExpiresAt.toISOString(),
        },
        new_cooldown_at: cooldownAt?.toISOString() ?? null,
        performance: Math.round(performance * 100),
        score_awarded: minigameScoreAmount,
        new_total_score: playerScoreResult?.newScore ?? null,
        new_tier: playerScoreResult?.tier ?? null
      };
    } catch (err) {
      await pool.query("ROLLBACK");
      throw err;
    }
  });

  app.post("/api/minigame/abandon", async (request, reply) => {
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
      `SELECT client_id, status FROM minigame_sessions WHERE session_id = $1`,
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

    // Mark session as abandoned (no cooldown penalty)
    await pool.query(
      `UPDATE minigame_sessions SET status = 'abandoned', completed_at = now() WHERE session_id = $1`,
      [sessionId]
    );

    return { ok: true };
  });
}
