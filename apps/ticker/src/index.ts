import * as dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { Pool } from "pg";
import { loopTicker } from "./ticker";
import type { PoolLike } from "./ticker";
import { logger } from "./logger";
import { syncCycleState } from "./cycle-store";
import { getPhaseMultipliers, applyDemoMultiplier } from "./multipliers";
import { applyRustSpread } from "./rust";
import { applyRoadDecay } from "./decay";
import { applyArrivedResourceTransfers, enqueueResourceTransfers, type ResourceTransfer } from "./resources";
import { dispatchCrews, arriveCrews, arriveCrewsAtHub, completeFinishedTasks } from "./crews";
import { spawnDegradedRoadTasks, updateTaskPriorities } from "./tasks";
import type { FeatureDelta, TaskDelta } from "./deltas";
import { notifyEvent } from "./notify";
import { getDemoConfig } from "./demo";
import { simulateBots } from "./bots";
import { runLamplighter } from "./lamplighter";
import { checkAndPerformReset } from "./reset";
import { cleanupOldData } from "./cleanup";
import { attachPoolErrorHandler } from "./pool";
import { calculateCityScore } from "@nightfall/config";
import { syncRegionWorkers } from "./worker-sync";

const intervalMs = Number(process.env.TICK_INTERVAL_MS ?? 10_000);
const lockId = Number(process.env.TICK_LOCK_ID ?? 424242);
const cleanupIntervalMs = Number(process.env.CLEANUP_INTERVAL_MS ?? 60 * 60 * 1000);
const workerSyncIntervalMs = Number(process.env.WORKER_SYNC_INTERVAL_MS ?? 5 * 60 * 1000); // 5 minutes

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

attachPoolErrorHandler(pool, logger);

let lastCleanupMs = 0;
let lastWorkerSyncMs = 0;

type RegionSnapshot = {
  region_id: string;
  pool_food: number;
  pool_equipment: number;
  pool_energy: number;
  pool_materials: number;
  rust_avg: number | null;
  health_avg: number | null;
  score: number;
};

async function fetchRegionSnapshots(client: PoolLike, regionIds: string[]): Promise<RegionSnapshot[]> {
  if (regionIds.length === 0) return [];

  const result = await client.query<Omit<RegionSnapshot, "score">>(
    `
    SELECT
      r.region_id,
      r.pool_food::float AS pool_food,
      r.pool_equipment::float AS pool_equipment,
      r.pool_energy::float AS pool_energy,
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

  // Calculate score for each region
  return result.rows.map((row) => ({
    ...row,
    score: calculateCityScore(row.health_avg, row.rust_avg)
  }));
}

type HexUpdate = { h3_index: string; rust_level: number; region_id?: string };

/**
 * Publish world delta with ID-only hex updates.
 * Client fetches full hex data from /api/batch/hexes.
 * Region updates are kept inline (small payload).
 */
async function publishWorldDelta(
  client: PoolLike,
  hexes: HexUpdate[],
  regionIds: string[]
) {
  const hexIds = Array.from(new Set(hexes.map((h) => h.h3_index)));
  const regionsChanged = Array.from(new Set(regionIds));

  // Region updates are small enough to send inline
  const regionUpdates = regionsChanged.length > 0 ? await fetchRegionSnapshots(client, regionsChanged) : [];

  if (hexIds.length === 0 && regionUpdates.length === 0) {
    return;
  }

  // Send hex IDs only (no full data) - client fetches from /api/batch/hexes
  // Can send many more IDs since each is ~20 bytes vs ~50 bytes for full update
  const HEX_ID_CHUNK_SIZE = 200;
  for (let i = 0; i < hexIds.length; i += HEX_ID_CHUNK_SIZE) {
    const chunk = hexIds.slice(i, i + HEX_ID_CHUNK_SIZE);
    const isFirstChunk = i === 0;
    await notifyEvent(client, "world_delta", {
      // ID-only format for client to fetch
      hex_ids: chunk,
      // Region updates inline (first chunk only)
      regions_changed: isFirstChunk ? regionsChanged : [],
      region_updates: isFirstChunk ? regionUpdates : []
    });
  }

  // If no hex updates but we have region updates, still send them
  if (hexIds.length === 0 && regionUpdates.length > 0) {
    await notifyEvent(client, "world_delta", {
      hex_ids: [],
      regions_changed: regionsChanged,
      region_updates: regionUpdates
    });
  }
}

// PostgreSQL NOTIFY has 8KB payload limit, chunk to stay under
const TASK_CHUNK_SIZE = 15; // Tasks have more fields, use smaller chunks
const FEATURE_ID_CHUNK_SIZE = 200; // IDs are small, can fit many

/**
 * Publish feature delta with ID-only updates.
 * Client fetches full feature data from /api/batch/features.
 */
async function publishFeatureDeltas(client: PoolLike, deltas: FeatureDelta[]) {
  if (deltas.length === 0) return;
  const featureIds = deltas.map(d => d.gers_id);
  for (let i = 0; i < featureIds.length; i += FEATURE_ID_CHUNK_SIZE) {
    const chunk = featureIds.slice(i, i + FEATURE_ID_CHUNK_SIZE);
    await notifyEvent(client, "feature_delta", { feature_ids: chunk });
  }
}

async function publishTaskDeltas(client: PoolLike, deltas: TaskDelta[]) {
  if (deltas.length === 0) return;
  // Send full task data so client can update without refetching
  for (let i = 0; i < deltas.length; i += TASK_CHUNK_SIZE) {
    const chunk = deltas.slice(i, i + TASK_CHUNK_SIZE);
    await notifyEvent(client, "task_delta", { tasks: chunk });
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

/**
 * Publish resource transfer with ID-only.
 * Client fetches full transfer data from /api/batch/transfers.
 */
async function publishResourceTransfers(client: PoolLike, transfers: ResourceTransfer[]) {
  if (transfers.length === 0) return;
  const transferIds = transfers.map(t => t.transfer_id);
  // Can batch many IDs since each is ~40 bytes
  await notifyEvent(client, "resource_transfer", { transfer_ids: transferIds });
}

// UUIDs are ~40 bytes each, chunk to stay under 8KB limit
const CREW_ID_CHUNK_SIZE = 100;

/**
 * Publish crew delta with ID-only updates.
 * Client fetches full crew data (with waypoints) from /api/batch/crews.
 */
async function publishCrewDeltas(client: PoolLike, crewEvents: { crew_id: string; region_id: string; event_type: string; waypoints?: unknown; position?: unknown; task_id?: string | null }[]) {
  if (crewEvents.length === 0) return;
  const crewIds = crewEvents.map(c => c.crew_id);
  // Chunk to stay under PostgreSQL NOTIFY 8KB limit
  for (let i = 0; i < crewIds.length; i += CREW_ID_CHUNK_SIZE) {
    const chunk = crewIds.slice(i, i + CREW_ID_CHUNK_SIZE);
    await notifyEvent(client, "crew_delta", { crew_ids: chunk });
  }
}

async function runTick(client: PoolLike) {
  const now = Date.now();
  await checkAndPerformReset(client);

  const demoConfig = await getDemoConfig(client);
  const cycleSpeed = demoConfig.enabled ? demoConfig.cycle_speed : 1;
  const tickMultiplier = demoConfig.enabled ? demoConfig.tick_multiplier : 1;

  const cycle = await syncCycleState(client, logger, cycleSpeed);
  const baseMultipliers = getPhaseMultipliers(cycle.phase);
  const multipliers = applyDemoMultiplier(baseMultipliers, tickMultiplier);

  const rustHexes = await applyRustSpread(client, multipliers);
  const decayFeatureDeltas = await applyRoadDecay(client, multipliers);
  const newTransfers = await enqueueResourceTransfers(client, multipliers);
  const arrivalResult = await applyArrivedResourceTransfers(client);

  const spawnedTasks = await spawnDegradedRoadTasks(client);
  const priorityUpdates = await updateTaskPriorities(client);
  const dispatchResult = await dispatchCrews(client);
  const crewArrivalResult = await arriveCrews(client, multipliers);
  const hubArrivalEvents = await arriveCrewsAtHub(client);
  const completionResult = await completeFinishedTasks(client, multipliers);

  await simulateBots(client, demoConfig.enabled);

  // The Lamplighter makes the world feel alive with per-region activity
  const lamplighterResult = await runLamplighter(client, demoConfig.enabled, cycle.phase);

  await publishWorldDelta(
    client,
    [...rustHexes, ...completionResult.rustHexes],
    [
      ...arrivalResult.regionIds,
      ...dispatchResult.regionIds,
      ...crewArrivalResult.regionIds,
      ...completionResult.regionIds,
      ...decayFeatureDeltas.map(d => d.region_id),
      ...rustHexes.map(h => h.region_id)
    ]
  );

  await publishFeatureDeltas(client, [
    ...decayFeatureDeltas,
    ...dispatchResult.featureDeltas,
    ...crewArrivalResult.featureDeltas,
    ...completionResult.featureDeltas
  ]);

  await publishTaskDeltas(client, [
    ...spawnedTasks,
    ...priorityUpdates,
    ...dispatchResult.taskDeltas,
    ...completionResult.taskDeltas
  ]);

  await publishFeedItems(client, completionResult.feedItems);

  await publishResourceTransfers(client, newTransfers);

  // Publish crew state changes for real-time animation updates
  await publishCrewDeltas(client, [
    ...dispatchResult.crewEvents,
    ...crewArrivalResult.crewEvents,
    ...hubArrivalEvents.map(e => ({ ...e, event_type: e.event_type })),
    ...completionResult.crewEvents
  ]);

  if (
    Number.isFinite(cleanupIntervalMs) &&
    cleanupIntervalMs > 0 &&
    now - lastCleanupMs >= cleanupIntervalMs
  ) {
    try {
      const stats = await cleanupOldData(client);
      lastCleanupMs = now;
      logger.info({ ...stats }, "cleanup complete");
    } catch (error) {
      logger.error({ err: error }, "cleanup failed");
    }
  }

  // Periodically sync worker count with hex count (1 worker per hex)
  if (
    Number.isFinite(workerSyncIntervalMs) &&
    workerSyncIntervalMs > 0 &&
    now - lastWorkerSyncMs >= workerSyncIntervalMs
  ) {
    try {
      await syncRegionWorkers(client);
      lastWorkerSyncMs = now;
    } catch (error) {
      logger.error({ err: error }, "worker sync failed");
    }
  }

  logger.info({
    rust_spread_count: rustHexes.length,
    decay_updates: decayFeatureDeltas.length,
    resource_transfers_created: newTransfers.length,
    resource_arrivals: arrivalResult.regionIds.length,
    tasks_spawned: spawnedTasks.length,
    tasks_updated: priorityUpdates.length,
    crews_dispatched: dispatchResult.crewEvents.length,
    crews_arrived: crewArrivalResult.crewEvents.length,
    crews_at_hub: hubArrivalEvents.length,
    tasks_completed: completionResult.taskDeltas.length,
    lamplighter_activities: lamplighterResult.regionActivities,
    lamplighter_contributions: lamplighterResult.contributions,
    lamplighter_votes: lamplighterResult.votes,
    lamplighter_warnings: lamplighterResult.warnings,
    lamplighter_observations: lamplighterResult.observations
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
