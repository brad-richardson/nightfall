import { describe, expect, it, vi } from "vitest";
import { completeFinishedTasks, dispatchCrews } from "./crews";

const multipliers = {
  rust_spread: 0.5,
  decay: 1,
  generation: 1,
  repair_speed: 2
};

describe("dispatchCrews", () => {
  it("returns when there are no idle crews", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });

    await dispatchCrews({ query }, multipliers);

    expect(query).toHaveBeenCalledTimes(1);
  });

  it("assigns an affordable task", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ crew_id: "crew-1", region_id: "region-1" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ pool_labor: 100, pool_materials: 100 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            task_id: "task-1",
            target_gers_id: "road-1",
            cost_labor: 20,
            cost_materials: 10,
            duration_s: 40
          }
        ]
      })
      .mockResolvedValue({ rows: [] });

    await dispatchCrews({ query }, multipliers);

    const updateCrewsCall = query.mock.calls.find((call) =>
      String(call[0]).includes("UPDATE crews")
    );

    expect(updateCrewsCall).toBeTruthy();
    expect(updateCrewsCall?.[1]).toEqual(["crew-1", "task-1", 20]);

    const commitCall = query.mock.calls.find((call) => call[0] === "COMMIT");
    expect(commitCall).toBeTruthy();
  });

  it("rolls back when no tasks are affordable", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ crew_id: "crew-1", region_id: "region-1" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ pool_labor: 5, pool_materials: 5 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await dispatchCrews({ query }, multipliers);

    const rollbackCall = query.mock.calls.find((call) => call[0] === "ROLLBACK");
    expect(rollbackCall).toBeTruthy();
  });
});

describe("completeFinishedTasks", () => {
  it("updates tasks, crews, and rust with pushback", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await completeFinishedTasks({ query }, multipliers);

    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0][0])).toContain("UPDATE tasks");
    expect(String(query.mock.calls[0][0])).toContain("UPDATE hex_cells");
    expect(query.mock.calls[0][1][0]).toBeCloseTo(0.02);
  });
});
