/**
 * Vote and task routes
 */

import type { FastifyInstance } from "fastify";
import { getPool } from "../db";
import { verifyToken } from "../utils/auth";
import { awardPlayerScore } from "../services/score";
import { LAMBDA, MAX_CLIENT_ID_LENGTH } from "../utils/constants";
import { ROAD_CLASSES, SCORE_ACTIONS, type PlayerTier } from "@nightfall/config";

export function registerVoteRoutes(app: FastifyInstance) {
  app.post("/api/vote", async (request, reply) => {
    const body = request.body as { client_id?: string; task_id?: string; weight?: number } | undefined;
    const clientId = body?.client_id?.trim();
    const taskId = body?.task_id?.trim();
    const weight = Number(body?.weight ?? 0);
    const authHeader = request.headers["authorization"];

    if (!clientId || !taskId || ![1, -1].includes(weight)) {
      reply.status(400);
      return { ok: false, error: "invalid_vote" };
    }

    if (!authHeader || !verifyToken(clientId, authHeader)) {
      reply.status(401);
      return { ok: false, error: "unauthorized" };
    }

    if (clientId.length > MAX_CLIENT_ID_LENGTH) {
      reply.status(400);
      return { ok: false, error: "client_id_too_long" };
    }

    const pool = getPool();

    await pool.query("BEGIN");

    try {
      const weightCases = Object.entries(ROAD_CLASSES)
        .map(([cls, info]) => `WHEN '${cls}' THEN ${info.priorityWeight}`)
        .join("\n          ");

      const taskResult = await pool.query("SELECT 1 FROM tasks WHERE task_id = $1 FOR UPDATE", [
        taskId
      ]);

      if (taskResult.rowCount === 0) {
        await pool.query("ROLLBACK");
        reply.status(404);
        return { ok: false, error: "task_not_found" };
      }

      // Check if this is a new vote (not a vote change)
      const existingVote = await pool.query(
        "SELECT 1 FROM task_votes WHERE task_id = $1 AND client_id = $2",
        [taskId, clientId]
      );
      const isNewVote = existingVote.rowCount === 0;

      await pool.query(
        `
        INSERT INTO task_votes (task_id, client_id, weight, created_at)
        VALUES ($1, $2, $3, now())
        ON CONFLICT (task_id, client_id)
        DO UPDATE SET weight = EXCLUDED.weight, created_at = now()
        `,
        [taskId, clientId, weight]
      );

      const scoreResult = await pool.query<{ vote_score: number }>(
        `
        SELECT
          COALESCE(SUM(weight * EXP(-$2::float * EXTRACT(EPOCH FROM (now() - created_at::timestamptz)) / 3600.0)), 0) AS vote_score
        FROM task_votes
        WHERE task_id = $1
        `,
        [taskId, LAMBDA]
      );

      const voteScore = Number(scoreResult.rows[0]?.vote_score ?? 0);

      const updatedTask = await pool.query<{
        task_id: string;
        status: string;
        priority_score: number;
        vote_score: number;
        cost_food: number;
        cost_equipment: number;
        cost_energy: number;
        cost_materials: number;
        duration_s: number;
        repair_amount: number;
        task_type: string;
        target_gers_id: string;
        region_id: string;
      }>(
        `
        UPDATE tasks AS t
        SET vote_score = $2::float,
            priority_score = (100 - COALESCE(fs.health, 100)) * (
              CASE wf.road_class
                ${weightCases}
                ELSE 1
              END
            ) + $2::float
        FROM world_features AS wf
        LEFT JOIN feature_state AS fs ON fs.gers_id = wf.gers_id
        WHERE t.task_id = $1
          AND wf.gers_id = t.target_gers_id
        RETURNING
          t.task_id,
          t.status,
          t.priority_score,
          t.vote_score,
          t.cost_food,
          t.cost_equipment,
          t.cost_energy,
          t.cost_materials,
          t.duration_s,
          t.repair_amount,
          t.task_type,
          t.target_gers_id,
          t.region_id
        `,
        [taskId, voteScore]
      );

      // Ensure we have task data to send in notification
      let taskDelta = updatedTask.rows[0];
      if (!taskDelta) {
        // Fallback: fetch task details if UPDATE didn't return rows (before COMMIT to stay in transaction)
        const fallbackTask = await pool.query<{
          task_id: string;
          status: string;
          priority_score: number;
          vote_score: number;
          cost_food: number;
          cost_equipment: number;
          cost_energy: number;
          cost_materials: number;
          duration_s: number;
          repair_amount: number;
          task_type: string;
          target_gers_id: string;
          region_id: string;
        }>(
          `SELECT task_id, status, priority_score, vote_score, cost_food, cost_equipment, cost_energy, cost_materials,
                  duration_s, repair_amount, task_type, target_gers_id, region_id
           FROM tasks WHERE task_id = $1`,
          [taskId]
        );
        taskDelta = fallbackTask.rows[0];
      }

      // Award vote score only for new votes (not vote changes)
      let playerScoreResult: { newScore: number; tier: PlayerTier } | null = null;
      if (isNewVote) {
        playerScoreResult = await awardPlayerScore(
          pool,
          clientId,
          "vote",
          SCORE_ACTIONS.voteSubmitted,
          taskDelta?.region_id,
          taskId
        );
      }

      await pool.query("COMMIT");

      // Send notification after successful commit if we have task data
      if (taskDelta) {
        await pool.query("SELECT pg_notify('task_delta', $1)", [
          JSON.stringify(taskDelta)
        ]);
      }

      return {
        ok: true,
        new_vote_score: voteScore,
        priority_score: taskDelta?.priority_score ?? null,
        score_awarded: isNewVote ? SCORE_ACTIONS.voteSubmitted : 0,
        new_total_score: playerScoreResult?.newScore ?? null,
        new_tier: playerScoreResult?.tier ?? null
      };
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  });

  app.get<{ Params: { task_id: string } }>("/api/tasks/:task_id", async (request, reply) => {
    const taskId = request.params.task_id;
    const pool = getPool();

    const taskResult = await pool.query<{
      task_id: string;
      target_gers_id: string;
      task_type: string;
      priority_score: number;
      vote_score: number;
      status: string;
      duration_s: number;
      created_at: string;
      road_class: string | null;
      health: number;
    }>(
      `
      SELECT
        t.task_id,
        t.target_gers_id,
        t.task_type,
        t.priority_score,
        t.vote_score,
        t.status,
        t.duration_s,
        t.created_at,
        wf.road_class,
        fs.health
      FROM tasks AS t
      JOIN world_features AS wf ON wf.gers_id = t.target_gers_id
      JOIN feature_state AS fs ON fs.gers_id = t.target_gers_id
      WHERE t.task_id = $1
      `,
      [taskId]
    );

    const task = taskResult.rows[0];
    if (!task) {
      reply.status(404);
      return { ok: false, error: "task_not_found" };
    }

    const voteScoreResult = await pool.query<{ vote_score: number }>(
      `
      SELECT
        COALESCE(SUM(weight * EXP(-$2::float * EXTRACT(EPOCH FROM (now() - created_at::timestamptz)) / 3600.0)), 0) AS vote_score
      FROM task_votes
      WHERE task_id = $1
      `,
      [taskId, LAMBDA]
    );

    const crewResult = await pool.query<{ busy_until: string | null }>(
      "SELECT busy_until FROM crews WHERE active_task_id = $1",
      [taskId]
    );

    const busyUntil = crewResult.rows[0]?.busy_until;
    const etaSeconds = busyUntil
      ? Math.max(0, Math.ceil((new Date(busyUntil).getTime() - Date.now()) / 1000))
      : null;

    return {
      task_id: task.task_id,
      target_gers_id: task.target_gers_id,
      task_type: task.task_type,
      road_class: task.road_class,
      health: task.health,
      priority_score: task.priority_score,
      votes: voteScoreResult.rows[0]?.vote_score ?? 0,
      status: task.status,
      eta: etaSeconds ?? task.duration_s
    };
  });
}
