export type PoolLike = {
  query: <T = unknown>(text: string, params?: unknown[]) => Promise<{ rows: T[] }>;
};

export type Logger = {
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

type RunWithLockArgs = {
  pool: PoolLike;
  lockId: number;
  runTick: () => Promise<void>;
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
  const lockResult = await pool.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_lock($1) AS locked",
    [lockId]
  );
  const locked = lockResult.rows[0]?.locked === true;

  if (!locked) {
    logger.info("[ticker] lock held by another worker");
    return;
  }

  const startedAt = Date.now();
  try {
    await runTick();
  } finally {
    await pool.query("SELECT pg_advisory_unlock($1)", [lockId]);
    const durationMs = Date.now() - startedAt;
    logger.info("[ticker] tick complete", { durationMs });
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
      lockArgs.logger.error("[ticker] tick failed", error);
    }

    const elapsedMs = Date.now() - startedAt;
    const waitMs = Math.max(0, intervalMs - elapsedMs);
    if (waitMs > 0) {
      await delay(waitMs);
    }
  }
}
