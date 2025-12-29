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

export async function notifyEvent(pool: PoolLike, channel: string, payload: unknown) {
  if (!CHANNELS.has(channel)) {
    throw new Error(`unsupported channel: ${channel}`);
  }

  await pool.query("SELECT pg_notify($1, $2)", [channel, JSON.stringify(payload)]);
}
