import { describe, expect, it, vi } from "vitest";
import { syncCycleState } from "./cycle-store";

const logger = {
  info: vi.fn(),
  error: vi.fn()
};

describe("syncCycleState", () => {
  it("does not notify when phase remains the same", async () => {
    const cycleStart = new Date("2025-01-01T00:00:00.000Z");
    const now = new Date("2025-01-01T00:01:00.000Z");

    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            cycle_start: cycleStart.toISOString(),
            phase: "dawn",
            phase_start: cycleStart.toISOString()
          }
        ]
      });

    await syncCycleState({ query }, logger, now);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain("cycle_state");
  });

  it("notifies and updates on phase change", async () => {
    const cycleStart = new Date("2025-01-01T00:00:00.000Z");
    const now = new Date("2025-01-01T00:11:00.000Z");

    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            cycle_start: cycleStart.toISOString(),
            phase: "day",
            phase_start: cycleStart.toISOString()
          }
        ]
      })
      .mockResolvedValue({ rows: [] });

    await syncCycleState({ query }, logger, now);

    const notifyCall = query.mock.calls.find((call) =>
      String(call[0]).includes("NOTIFY phase_change")
    );
    expect(notifyCall).toBeTruthy();
  });
});
