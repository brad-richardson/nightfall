/**
 * Player-related routes: hello, score, set-home, leaderboard
 */

import type { FastifyInstance } from "fastify";
import { getPool } from "../db";
import { loadCycleSummary } from "../cycle";
import { signClientId, verifyToken } from "../utils/auth";
import { getPlayerScoreData } from "../services/score";
import {
  MAX_CLIENT_ID_LENGTH,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_REGION_ID_LENGTH
} from "../utils/constants";
import {
  getPlayerTier,
  getPlayerTierConfig,
  getTierProgress
} from "@nightfall/config";

export function registerPlayerRoutes(app: FastifyInstance) {
  app.post("/api/hello", async (request, reply) => {
    const body = request.body as { client_id?: string; display_name?: string } | undefined;
    const clientId = body?.client_id?.trim();
    const displayName = body?.display_name?.trim();

    if (!clientId) {
      reply.status(400);
      return { ok: false, error: "client_id_required" };
    }

    if (clientId.length > MAX_CLIENT_ID_LENGTH) {
      reply.status(400);
      return { ok: false, error: "client_id_too_long" };
    }

    if (displayName && displayName.length > MAX_DISPLAY_NAME_LENGTH) {
      reply.status(400);
      return { ok: false, error: "display_name_too_long" };
    }

    const pool = getPool();

    await pool.query(
      `
      INSERT INTO players (client_id, display_name, last_seen)
      VALUES ($1, $2, now())
      ON CONFLICT (client_id)
      DO UPDATE SET
        display_name = COALESCE(EXCLUDED.display_name, players.display_name),
        last_seen = now()
      `,
      [clientId, displayName ?? null]
    );

    const playerResult = await pool.query<{ home_region_id: string | null }>(
      "SELECT home_region_id FROM players WHERE client_id = $1",
      [clientId]
    );

    const worldResult = await pool.query<{ version: string | null }>(
      "SELECT value->>'version' as version FROM world_meta WHERE key = 'last_reset'"
    );
    const worldVersion = Number(worldResult.rows[0]?.version ?? 1);

    const regionsResult = await pool.query<{
      region_id: string;
      name: string;
      center: unknown;
    }>(
      "SELECT region_id, name, ST_AsGeoJSON(center)::json as center FROM regions ORDER BY name"
    );

    const cycle = await loadCycleSummary(pool);

    return {
      ok: true,
      token: signClientId(clientId),
      world_version: worldVersion,
      home_region_id: playerResult.rows[0]?.home_region_id ?? null,
      regions: regionsResult.rows,
      cycle
    };
  });

  app.get<{ Querystring: { client_id?: string } }>("/api/player/score", async (request, reply) => {
    reply.header("Cache-Control", "no-store");

    const clientId = request.query.client_id?.trim();
    const authHeader = request.headers["authorization"];

    if (!clientId) {
      reply.status(400);
      return { ok: false, error: "client_id_required" };
    }

    if (clientId.length > MAX_CLIENT_ID_LENGTH) {
      reply.status(400);
      return { ok: false, error: "client_id_too_long" };
    }

    if (!authHeader || !verifyToken(clientId, authHeader)) {
      reply.status(401);
      return { ok: false, error: "unauthorized" };
    }

    const pool = getPool();

    // Get player's score data
    const scoreData = await getPlayerScoreData(pool, clientId);

    if (!scoreData) {
      // Player exists but has no score record yet - return zeros
      const playerCheck = await pool.query("SELECT 1 FROM players WHERE client_id = $1", [clientId]);
      if (playerCheck.rowCount === 0) {
        reply.status(404);
        return { ok: false, error: "player_not_found" };
      }

      const tierProgress = getTierProgress(0);
      return {
        ok: true,
        score: {
          total: 0,
          contribution: 0,
          vote: 0,
          minigame: 0,
          taskCompletion: 0
        },
        tier: {
          current: tierProgress.currentTier,
          next: tierProgress.nextTier,
          progress: tierProgress.progress,
          scoreToNext: tierProgress.scoreToNext,
          config: getPlayerTierConfig(0)
        }
      };
    }

    const tierProgress = getTierProgress(scoreData.total_score);

    // Get player's leaderboard position using same COALESCE logic as leaderboard endpoint
    const rankResult = await pool.query<{ rank: number }>(
      `SELECT COUNT(*) + 1 AS rank
       FROM players p
       LEFT JOIN player_scores ps ON ps.client_id = p.client_id
       WHERE COALESCE(ps.total_score, p.lifetime_contrib, 0) > $1`,
      [scoreData.total_score]
    );
    const rank = Number(rankResult.rows[0]?.rank ?? 1);

    return {
      ok: true,
      score: {
        total: scoreData.total_score,
        contribution: scoreData.contribution_score,
        vote: scoreData.vote_score,
        minigame: scoreData.minigame_score,
        taskCompletion: scoreData.task_completion_bonus
      },
      tier: {
        current: tierProgress.currentTier,
        next: tierProgress.nextTier,
        progress: tierProgress.progress,
        scoreToNext: tierProgress.scoreToNext,
        config: getPlayerTierConfig(scoreData.total_score)
      },
      rank
    };
  });

  app.post("/api/set-home", async (request, reply) => {
    const body = request.body as { client_id?: string; region_id?: string } | undefined;
    const clientId = body?.client_id?.trim();
    const regionId = body?.region_id?.trim();
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

    const pool = getPool();
    const updateResult = await pool.query<{ home_region_id: string }>(
      "UPDATE players SET home_region_id = $2 WHERE client_id = $1 AND home_region_id IS NULL RETURNING home_region_id",
      [clientId, regionId]
    );

    if (updateResult.rows[0]) {
      return { ok: true, home_region_id: updateResult.rows[0].home_region_id };
    }

    const existing = await pool.query<{ home_region_id: string | null }>(
      "SELECT home_region_id FROM players WHERE client_id = $1",
      [clientId]
    );

    return {
      ok: false,
      home_region_id: existing.rows[0]?.home_region_id ?? null
    };
  });

  app.get<{ Querystring: { limit?: string; region_id?: string } }>("/api/leaderboard", async (request, reply) => {
    reply.header("Cache-Control", "no-store");

    const limit = Math.min(100, Math.max(1, parseInt(request.query.limit ?? "50", 10) || 50));
    const regionFilter = request.query.region_id?.trim();
    const pool = getPool();

    // Query players from player_scores table, joined with players for display info
    // Falls back to lifetime_contrib for players without score records (backwards compatibility)
    const result = await pool.query<{
      client_id: string;
      display_name: string | null;
      total_score: number;
      contribution_score: number;
      vote_score: number;
      minigame_score: number;
      task_completion_bonus: number;
      home_region_id: string | null;
      last_seen: string;
    }>(
      `SELECT
        p.client_id,
        p.display_name,
        COALESCE(ps.total_score, p.lifetime_contrib, 0) AS total_score,
        COALESCE(ps.contribution_score, 0) AS contribution_score,
        COALESCE(ps.vote_score, 0) AS vote_score,
        COALESCE(ps.minigame_score, 0) AS minigame_score,
        COALESCE(ps.task_completion_bonus, 0) AS task_completion_bonus,
        p.home_region_id,
        p.last_seen::text
      FROM players p
      LEFT JOIN player_scores ps ON ps.client_id = p.client_id
      WHERE COALESCE(ps.total_score, p.lifetime_contrib, 0) > 0
        ${regionFilter ? "AND p.home_region_id = $2" : ""}
      ORDER BY COALESCE(ps.total_score, p.lifetime_contrib, 0) DESC
      LIMIT $1`,
      regionFilter ? [limit, regionFilter] : [limit]
    );

    return {
      ok: true,
      leaderboard: result.rows.map((row, index) => {
        const score = Number(row.total_score);
        const tier = getPlayerTier(score);
        const tierConfig = getPlayerTierConfig(score);

        return {
          rank: index + 1,
          // Use truncated client_id suffix as anonymous identifier (privacy: don't expose full client_id)
          playerId: row.client_id.slice(-8),
          displayName: row.display_name || `Player ${row.client_id.slice(-6)}`,
          score,
          tier,
          tierBadge: tierConfig.badgeIcon,
          tierColor: tierConfig.color,
          breakdown: {
            contribution: Number(row.contribution_score),
            vote: Number(row.vote_score),
            minigame: Number(row.minigame_score),
            taskCompletion: Number(row.task_completion_bonus)
          },
          homeRegionId: row.home_region_id,
          lastSeen: row.last_seen
        };
      })
    };
  });
}
