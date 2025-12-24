import { Pool } from "pg";
import { loopTicker } from "./ticker";
import { syncCycleState } from "./cycle-store";
import { getPhaseMultipliers } from "./multipliers";
import { applyRustSpread } from "./rust";
import { applyRoadDecay } from "./decay";
import { generateRegionResources } from "./resources";
import { dispatchCrews, completeFinishedTasks } from "./crews";
import { spawnDegradedRoadTasks, updateTaskPriorities } from "./tasks";

const intervalMs = Number(process.env.TICK_INTERVAL_MS ?? 10_000);
const lockId = Number(process.env.TICK_LOCK_ID ?? 424242);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const logger = {
  info: console.info,
  error: console.error
};

async function runTick() {
  const cycle = await syncCycleState(pool, logger);
  const multipliers = getPhaseMultipliers(cycle.phase);

  await applyRustSpread(pool, multipliers);
  await applyRoadDecay(pool, multipliers);
  await generateRegionResources(pool, multipliers);
  await spawnDegradedRoadTasks(pool);
  await updateTaskPriorities(pool);
  await dispatchCrews(pool, multipliers);
  await completeFinishedTasks(pool, multipliers);
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
