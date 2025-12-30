export type PoolLike = {
  query: <T = unknown>(text: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount?: number | null }>;
  connect?: () => Promise<PoolClientLike>;
};

export type PoolClientLike = {
  query: <T = unknown>(text: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount?: number | null }>;
  release?: () => void | Promise<void>;
};

export type Logger = {
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

type RunWithLockArgs = {
  pool: PoolLike;
  lockId: number;
  runTick: (pool: PoolLike) => Promise<void>;
  logger: Logger;
};

type LoopArgs = RunWithLockArgs & {
  intervalMs: number;
  shouldContinue: () => boolean;
};

/**
 * Acquire an advisory lock and run the tick.
 * Each operation group within runTick manages its own transaction.
 */
export async function runWithAdvisoryLock({
  pool,
  lockId,
  runTick,
  logger
}: RunWithLockArgs) {
  const lockClient = pool.connect ? await pool.connect() : null;

  if (!lockClient) {
    logger.error("[ticker] pool.connect() required for advisory locks");
    return;
  }

  let locked = false;
  const startedAt = Date.now();

  try {
    const lockResult = await lockClient.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [lockId]
    );
    locked = lockResult.rows[0]?.locked === true;

    if (!locked) {
      logger.info("lock held by another worker");
      return;
    }

    // Pass the pool to runTick - each operation group manages its own transaction
    await runTick(pool);
  } finally {
    if (locked) {
      await lockClient.query("SELECT pg_advisory_unlock($1)", [lockId]);
      const durationMs = Date.now() - startedAt;
      logger.info({ durationMs }, "tick complete");
    }

    if (typeof lockClient.release === "function") {
      await lockClient.release();
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
