import { describe, expect, it, vi } from "vitest";
import { runWithAdvisoryLock } from "./ticker";

describe("runWithAdvisoryLock", () => {
  it("skips tick when lock is not acquired", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ locked: false }] });
    const release = vi.fn();
    const connect = vi.fn().mockResolvedValue({ query, release });
    const poolQuery = vi.fn();
    const runTick = vi.fn();
    const logger = { info: vi.fn(), error: vi.fn() };

    await runWithAdvisoryLock({
      pool: { connect, query: poolQuery },
      lockId: 1,
      runTick,
      logger
    });

    expect(runTick).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("runs tick when lock is acquired", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValue({ rows: [] });
    const release = vi.fn();
    const connect = vi.fn().mockResolvedValue({ query, release });
    const poolQuery = vi.fn();
    const runTick = vi.fn().mockResolvedValue(undefined);
    const logger = { info: vi.fn(), error: vi.fn() };

    await runWithAdvisoryLock({
      pool: { connect, query: poolQuery },
      lockId: 1,
      runTick,
      logger
    });

    expect(runTick).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
    // Only 2 queries now: lock check and unlock (no more BEGIN/COMMIT wrapper)
    // Each operation group in runTick manages its own transaction
    expect(query).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
