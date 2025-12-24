import { describe, expect, it, vi } from "vitest";
import { runWithAdvisoryLock } from "./ticker";

describe("runWithAdvisoryLock", () => {
  it("skips tick when lock is not acquired", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ locked: false }] });
    const runTick = vi.fn();
    const logger = { info: vi.fn(), error: vi.fn() };

    await runWithAdvisoryLock({
      pool: { query },
      lockId: 1,
      runTick,
      logger
    });

    expect(runTick).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("runs tick when lock is acquired", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValueOnce({ rows: [] });
    const runTick = vi.fn().mockResolvedValue(undefined);
    const logger = { info: vi.fn(), error: vi.fn() };

    await runWithAdvisoryLock({
      pool: { query },
      lockId: 1,
      runTick,
      logger
    });

    expect(runTick).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
