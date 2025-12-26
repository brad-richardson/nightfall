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

    await syncCycleState({ query }, logger, 1, now);

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

    await syncCycleState({ query }, logger, 1, now);

    const notifyCall = query.mock.calls.find((call) =>
      String(call[0]).includes("pg_notify") && call[1]?.[0] === "phase_change"
    );
    expect(notifyCall).toBeTruthy();
  });

  it("casts cycle_state payload parameters to text", async () => {
    const now = new Date("2025-01-01T00:01:00.000Z");

    const query = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValue({ rows: [] });

    await syncCycleState({ query }, logger, 1, now);

    const insertCall = query.mock.calls.find((call) =>
      String(call[0]).includes("INSERT INTO world_meta")
    );

    expect(insertCall).toBeTruthy();
    expect(String(insertCall?.[0])).toContain("$1::text");
    expect(String(insertCall?.[0])).toContain("$2::text");
    expect(String(insertCall?.[0])).toContain("$3::text");
  });
});
