export type PoolLike = {
  query: <T = unknown>(text: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  connect?: () => Promise<PoolClientLike>;
};

export type PoolClientLike = {
  query: <T = unknown>(text: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  release?: () => void | Promise<void>;
};

export type Logger = {
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

type RunWithLockArgs = {
  pool: PoolLike;
  lockId: number;
  runTick: (client: PoolLike) => Promise<void>;
  logger: Logger;
};

type LoopArgs = RunWithLockArgs & {
  intervalMs: number;
  shouldContinue: () => boolean;
};

export async function runWithAdvisoryLock({
  pool,
  lockId,
  runTick,
  logger
}: RunWithLockArgs) {
  const client = pool.connect ? await pool.connect() : null;

  if (!client) {
    logger.error("[ticker] pool.connect() required for advisory locks");
    return;
  }

  let locked = false;
  const startedAt = Date.now();

  try {
    const lockResult = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [lockId]
    );
    locked = lockResult.rows[0]?.locked === true;

    if (!locked) {
      logger.info("lock held by another worker");
      return;
    }

    try {
      await client.query("BEGIN");
      await runTick(client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    if (locked) {
      await client.query("SELECT pg_advisory_unlock($1)", [lockId]);
      const durationMs = Date.now() - startedAt;
      logger.info({ durationMs }, "tick complete");
    }

    if (typeof client.release === "function") {
      await client.release();
    }
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function loopTicker({
  intervalMs,
  shouldContinue,
  ...lockArgs
}: LoopArgs) {
  while (shouldContinue()) {
    const startedAt = Date.now();

    try {
      await runWithAdvisoryLock(lockArgs);
    } catch (error) {
      lockArgs.logger.error({ err: error }, "tick failed");
    }

    const elapsedMs = Date.now() - startedAt;
    const waitMs = Math.max(0, intervalMs - elapsedMs);
    if (waitMs > 0) {
      await delay(waitMs);
    }
  }
}
