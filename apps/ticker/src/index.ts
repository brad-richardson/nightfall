import { Pool } from "pg";
import { loopTicker } from "./ticker";
import type { PoolLike } from "./ticker";
import { syncCycleState } from "./cycle-store";
import { getPhaseMultipliers } from "./multipliers";
import { applyRustSpread } from "./rust";
import { applyRoadDecay } from "./decay";
import { generateRegionResources } from "./resources";
import { dispatchCrews, completeFinishedTasks } from "./crews";
import { spawnDegradedRoadTasks, updateTaskPriorities } from "./tasks";
import type { FeatureDelta, TaskDelta } from "./deltas";
import { notifyEvent } from "./notify";

const intervalMs = Number(process.env.TICK_INTERVAL_MS ?? 10_000);
const lockId = Number(process.env.TICK_LOCK_ID ?? 424242);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const logger = {
  info: console.info,
  error: console.error
};

async function publishWorldDelta(
  client: PoolLike,
  rustHexes: string[],
  regionIds: string[]
) {
  const rustChanged = Array.from(new Set(rustHexes));
  const regionsChanged = Array.from(new Set(regionIds));

  if (rustChanged.length === 0 && regionsChanged.length === 0) {
    return;
  }

  await notifyEvent(client, "world_delta", {
    rust_changed: rustChanged,
    regions_changed: regionsChanged
  });
}

async function publishFeatureDeltas(client: PoolLike, deltas: FeatureDelta[]) {
  for (const delta of deltas) {
    await notifyEvent(client, "feature_delta", delta);
  }
}

async function publishTaskDeltas(client: PoolLike, deltas: TaskDelta[]) {
  for (const delta of deltas) {
    await notifyEvent(client, "task_delta", delta);
  }
}

async function publishFeedItems(
  client: PoolLike,
  items: { event_type: string; region_id: string | null; message: string; ts: string }[]
) {
  for (const item of items) {
    await notifyEvent(client, "feed_item", item);
  }
}

async function runTick(client: PoolLike) {
  const cycle = await syncCycleState(client, logger);
  const multipliers = getPhaseMultipliers(cycle.phase);

  const rustHexes = await applyRustSpread(client, multipliers);
  const decayFeatureDeltas = await applyRoadDecay(client, multipliers);
  const regionIds = await generateRegionResources(client, multipliers);
  const spawnedTasks = await spawnDegradedRoadTasks(client);
  const priorityUpdates = await updateTaskPriorities(client);
  const dispatchResult = await dispatchCrews(client, multipliers);
  const completionResult = await completeFinishedTasks(client, multipliers);

  await publishWorldDelta(
    client,
    [...rustHexes, ...completionResult.rustHexes],
    [...regionIds, ...dispatchResult.regionIds, ...completionResult.regionIds]
  );

  await publishFeatureDeltas(client, [
    ...decayFeatureDeltas,
    ...dispatchResult.featureDeltas,
    ...completionResult.featureDeltas
  ]);

  await publishTaskDeltas(client, [
    ...spawnedTasks,
    ...priorityUpdates,
    ...dispatchResult.taskDeltas,
    ...completionResult.taskDeltas
  ]);

  await publishFeedItems(client, completionResult.feedItems);
}

let running = true;

async function shutdown(signal: string) {
  logger.info(`[ticker] received ${signal}, shutting down`);
  running = false;
  await pool.end();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

loopTicker({
  intervalMs,
  lockId,
  pool,
  runTick,
  logger,
  shouldContinue: () => running
}).catch((error) => {
  logger.error("[ticker] fatal error", error);
  process.exit(1);
});
