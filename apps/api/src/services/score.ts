/**
 * Score tracking service for player scores
 */

import { getPool } from "../db";
import { getPlayerTier, type PlayerTier } from "@nightfall/config";

export type ScoreEventType = "contribution" | "vote" | "minigame" | "task_completion";

export interface PlayerScoreData {
  total_score: number;
  contribution_score: number;
  vote_score: number;
  minigame_score: number;
  task_completion_bonus: number;
}

/**
 * Award score to a player and record the event
 * This upserts the player_scores record and creates a score_event for audit trail
 */
export async function awardPlayerScore(
  pool: ReturnType<typeof getPool>,
  clientId: string,
  eventType: ScoreEventType,
  amount: number,
  regionId?: string,
  relatedId?: string
): Promise<{ newScore: number; tier: PlayerTier } | null> {
  if (amount <= 0) return null;

  const scoreColumn = {
    contribution: "contribution_score",
    vote: "vote_score",
    minigame: "minigame_score",
    task_completion: "task_completion_bonus"
  }[eventType];

  // Upsert player_scores and get new total
  const result = await pool.query<{ total_score: number }>(
    `
    INSERT INTO player_scores (client_id, ${scoreColumn}, total_score, updated_at)
    VALUES ($1, $2, $2, now())
    ON CONFLICT (client_id) DO UPDATE SET
      ${scoreColumn} = player_scores.${scoreColumn} + $2,
      total_score = player_scores.total_score + $2,
      updated_at = now()
    RETURNING total_score
    `,
    [clientId, amount]
  );

  // Record score event for audit trail
  await pool.query(
    `
    INSERT INTO score_events (client_id, event_type, amount, region_id, related_id)
    VALUES ($1, $2, $3, $4, $5)
    `,
    [clientId, eventType, amount, regionId || null, relatedId || null]
  );

  const newScore = Number(result.rows[0]?.total_score ?? 0);
  return {
    newScore,
    tier: getPlayerTier(newScore)
  };
}

/**
 * Get player's current score data
 */
export async function getPlayerScoreData(
  pool: ReturnType<typeof getPool>,
  clientId: string
): Promise<PlayerScoreData | null> {
  const result = await pool.query<PlayerScoreData>(
    `
    SELECT
      total_score,
      contribution_score,
      vote_score,
      minigame_score,
      task_completion_bonus
    FROM player_scores
    WHERE client_id = $1
    `,
    [clientId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return {
    total_score: Number(result.rows[0].total_score),
    contribution_score: Number(result.rows[0].contribution_score),
    vote_score: Number(result.rows[0].vote_score),
    minigame_score: Number(result.rows[0].minigame_score),
    task_completion_bonus: Number(result.rows[0].task_completion_bonus)
  };
}
