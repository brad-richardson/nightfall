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

    const result = await dispatchCrews({ query }, multipliers);

    expect(result).toEqual({ taskDeltas: [], featureDeltas: [], regionIds: [] });
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
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ task_id: "task-1", status: "active", priority_score: 10 }]
      })
      .mockResolvedValueOnce({
        rows: [{ gers_id: "road-1", health: 50, status: "repairing" }]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await dispatchCrews({ query }, multipliers);

    expect(result.taskDeltas).toEqual([
      { task_id: "task-1", status: "active", priority_score: 10 }
    ]);
    expect(result.featureDeltas).toEqual([
      { gers_id: "road-1", health: 50, status: "repairing" }
    ]);
    expect(result.regionIds).toEqual(["region-1"]);

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

    const result = await dispatchCrews({ query }, multipliers);

    expect(result).toEqual({ taskDeltas: [], featureDeltas: [], regionIds: [] });

    const rollbackCall = query.mock.calls.find((call) => call[0] === "ROLLBACK");
    expect(rollbackCall).toBeTruthy();
  });
});

describe("completeFinishedTasks", () => {
  it("updates tasks, crews, and rust with pushback", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            tasks: [
              {
                task_id: "task-1",
                status: "done",
                priority_score: 10,
                region_id: "region-1"
              }
            ],
            features: [{ gers_id: "road-1", health: 80, status: "normal" }],
            hexes: ["hex-1"]
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await completeFinishedTasks({ query }, multipliers);

    expect(result.taskDeltas).toEqual([
      { task_id: "task-1", status: "done", priority_score: 10 }
    ]);
    expect(result.featureDeltas).toEqual([
      { gers_id: "road-1", health: 80, status: "normal" }
    ]);
    expect(result.rustHexes).toEqual(["hex-1"]);
    expect(result.regionIds).toEqual(["region-1"]);
    expect(result.feedItems[0]?.event_type).toBe("task_complete");
  });
});
