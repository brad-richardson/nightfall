import { Pool } from "pg";
import { getConfig } from "./config";
import { logger } from "./logger";
import { loopTicker } from "./ticker";

const config = getConfig();

const pool = new Pool({
  connectionString: config.DATABASE_URL
});

async function runTick() {
  // Placeholder for week 2 tick steps.
  return;
}

let running = true;

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  running = false;
  await pool.end();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

loopTicker({
  intervalMs: config.TICK_INTERVAL_MS,
  lockId: config.TICK_LOCK_ID,
  pool,
  runTick,
  logger,
  shouldContinue: () => running
}).catch((error) => {
  logger.error({ err: error }, "fatal error");
  process.exit(1);
});
