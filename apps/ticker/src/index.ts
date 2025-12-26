import * as dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { Pool } from "pg";
import { loopTicker } from "./ticker";
import type { PoolLike } from "./ticker";
import { logger } from "./logger";
import { syncCycleState } from "./cycle-store";
import { getPhaseMultipliers, applyDemoMultiplier } from "./multipliers";
import { applyRustSpread, type RustUpdate } from "./rust";
import { applyRoadDecay } from "./decay";
import { generateRegionResources } from "./resources";
import { dispatchCrews, completeFinishedTasks } from "./crews";
import { spawnDegradedRoadTasks, updateTaskPriorities } from "./tasks";
import type { FeatureDelta, TaskDelta } from "./deltas";
import { notifyEvent } from "./notify";
import { getDemoConfig } from "./demo";
import { simulateBots } from "./bots";
import { checkAndPerformReset } from "./reset";

const intervalMs = Number(process.env.TICK_INTERVAL_MS ?? 10_000);
const lockId = Number(process.env.TICK_LOCK_ID ?? 424242);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

type RegionSnapshot = {
  region_id: string;
  pool_labor: number;
  pool_materials: number;
  rust_avg: number | null;
  health_avg: number | null;
};

async function fetchRegionSnapshots(client: PoolLike, regionIds: string[]): Promise<RegionSnapshot[]> {
  if (regionIds.length === 0) return [];

  const result = await client.query<RegionSnapshot>(
    `
    SELECT
      r.region_id,
      r.pool_labor::float AS pool_labor,
      r.pool_materials::float AS pool_materials,
      (
        SELECT AVG(rust_level)::float FROM hex_cells WHERE region_id = r.region_id
      ) AS rust_avg,
      (
        SELECT AVG(fs.health)::float
        FROM world_features AS wf
        JOIN feature_state AS fs ON fs.gers_id = wf.gers_id
        WHERE wf.region_id = r.region_id
          AND wf.feature_type = 'road'
      ) AS health_avg
    FROM regions AS r
    WHERE r.region_id = ANY($1::text[])
    `,
    [regionIds]
  );

  return result.rows;
}

async function publishWorldDelta(
  client: PoolLike,
  rustHexes: RustUpdate[],
  regionIds: string[]
) {
  const hexUpdates = Array.from(new Map(rustHexes.map((h) => [h.h3_index, h])).values());
  const regionsChanged = Array.from(new Set(regionIds));

  const regionUpdates = regionsChanged.length > 0 ? await fetchRegionSnapshots(client, regionsChanged) : [];

  if (hexUpdates.length === 0 && regionUpdates.length === 0) {
    return;
  }

  await notifyEvent(client, "world_delta", {
    rust_changed: hexUpdates.map((h) => h.h3_index),
    hex_updates: hexUpdates,
    regions_changed: regionsChanged,
    region_updates: regionUpdates
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
  await checkAndPerformReset(client);

  const demoConfig = await getDemoConfig(client);
  const cycleSpeed = demoConfig.enabled ? demoConfig.cycle_speed : 1;
  const tickMultiplier = demoConfig.enabled ? demoConfig.tick_multiplier : 1;

  const cycle = await syncCycleState(client, logger, cycleSpeed);
  const baseMultipliers = getPhaseMultipliers(cycle.phase);
  const multipliers = applyDemoMultiplier(baseMultipliers, tickMultiplier);

  const rustHexes = await applyRustSpread(client, multipliers);
  const decayFeatureDeltas = await applyRoadDecay(client, multipliers);
  const regionIds = await generateRegionResources(client, multipliers);
  const spawnedTasks = await spawnDegradedRoadTasks(client);
  const priorityUpdates = await updateTaskPriorities(client);
  const dispatchResult = await dispatchCrews(client, multipliers);
  const completionResult = await completeFinishedTasks(client, multipliers);

  await simulateBots(client, demoConfig.enabled);

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

  logger.info({
    rust_spread_count: rustHexes.length,
    decay_updates: decayFeatureDeltas.length,
    tasks_spawned: spawnedTasks.length,
    tasks_updated: priorityUpdates.length,
    crews_dispatched: dispatchResult.taskDeltas.length,
    tasks_completed: completionResult.taskDeltas.length
  }, "tick stats");
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
