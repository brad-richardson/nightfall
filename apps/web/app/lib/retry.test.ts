import { describe, expect, it, vi } from "vitest";
import { withRetry } from "./retry";

describe("withRetry", () => {
  it("retries a failing function until it succeeds", async () => {
    vi.useFakeTimers();
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("ok");

    const promise = withRetry(fn, { attempts: 2, baseDelayMs: 10, maxDelayMs: 10, jitter: 0 });

    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
