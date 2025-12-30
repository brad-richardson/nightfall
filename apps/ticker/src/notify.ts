import type { PoolLike } from "./ticker";

const CHANNELS = new Set([
  "phase_change",
  "world_delta",
  "feature_delta",
  "task_delta",
  "feed_item",
  "resource_transfer",
  "crew_delta",
  "reset_warning",
  "reset"
]);

/**
 * Persists an event to the game_events table and notifies listeners via pg_notify.
 * Events are persisted with a sequence ID for replay on client reconnection.
 */
export async function notifyEvent(pool: PoolLike, channel: string, payload: unknown) {
  if (!CHANNELS.has(channel)) {
    throw new Error(`unsupported channel: ${channel}`);
  }

  // Persist event and get sequence ID for replay capability
  const result = await pool.query<{ seq_id: string }>(
    `INSERT INTO game_events (channel, payload) VALUES ($1, $2) RETURNING seq_id`,
    [channel, JSON.stringify(payload)]
  );
  const seqId = result.rows[0]?.seq_id;

  // Include seq_id in payload for client tracking
  const enrichedPayload = { seq_id: seqId, ...(payload as object) };
  await pool.query("SELECT pg_notify($1, $2)", [channel, JSON.stringify(enrichedPayload)]);
}
