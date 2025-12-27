import { describe, expect, it, vi } from "vitest";
import { completeFinishedTasks, dispatchCrews, arriveCrews } from "./crews";

const multipliers = {
  rust_spread: 0.5,
  decay: 1,
  generation: 1,
  repair_speed: 2
};

describe("dispatchCrews", () => {
  it("returns when there are no idle crews", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });

    const result = await dispatchCrews({ query });

    expect(result).toEqual({ taskDeltas: [], featureDeltas: [], regionIds: [] });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("assigns an affordable task and sets crew to traveling", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ crew_id: "crew-1", region_id: "region-1" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ pool_food: 100, pool_equipment: 100, pool_energy: 100, pool_materials: 100 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            task_id: "task-1",
            target_gers_id: "road-1",
            cost_food: 20,
            cost_equipment: 10,
            cost_energy: 5,
            cost_materials: 10,
            duration_s: 40
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ task_id: "task-1", status: "active", priority_score: 10 }]
      })
      .mockResolvedValueOnce({ rows: [] }) // crew update to 'traveling'
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const result = await dispatchCrews({ query });

    expect(result.taskDeltas).toEqual([
      { task_id: "task-1", status: "active", priority_score: 10 }
    ]);
    // featureDeltas is now empty - roads are updated when crews arrive
    expect(result.featureDeltas).toEqual([]);
    expect(result.regionIds).toEqual(["region-1"]);

    const commitCall = query.mock.calls.find((call) => call[0] === "COMMIT");
    expect(commitCall).toBeTruthy();

    // Verify crew was set to 'traveling' not 'working'
    const crewUpdateCall = query.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("status = 'traveling'")
    );
    expect(crewUpdateCall).toBeTruthy();
  });

  it("rolls back when no tasks are affordable", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ crew_id: "crew-1", region_id: "region-1" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ pool_food: 5, pool_equipment: 5, pool_energy: 5, pool_materials: 5 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await dispatchCrews({ query });

    expect(result).toEqual({ taskDeltas: [], featureDeltas: [], regionIds: [] });

    const rollbackCall = query.mock.calls.find((call) => call[0] === "ROLLBACK");
    expect(rollbackCall).toBeTruthy();
  });
});

describe("arriveCrews", () => {
  it("transitions traveling crews to working and sets road to repairing", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            crew_id: "crew-1",
            region_id: "region-1",
            active_task_id: "task-1",
            duration_s: 40,
            target_gers_id: "road-1"
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // crew update to 'working'
      .mockResolvedValueOnce({
        rows: [{ gers_id: "road-1", region_id: "region-1", health: 50, status: "repairing" }]
      })
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const result = await arriveCrews({ query }, multipliers);

    expect(result.featureDeltas).toEqual([
      { gers_id: "road-1", region_id: "region-1", health: 50, status: "repairing" }
    ]);
    expect(result.regionIds).toEqual(["region-1"]);

    // Verify transaction was used
    const beginCall = query.mock.calls.find((call) => call[0] === "BEGIN");
    expect(beginCall).toBeTruthy();
    const commitCall = query.mock.calls.find((call) => call[0] === "COMMIT");
    expect(commitCall).toBeTruthy();

    // Verify crew was set to 'working'
    const crewUpdateCall = query.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("status = 'working'")
    );
    expect(crewUpdateCall).toBeTruthy();
  });

  it("returns empty results when no crews are traveling", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });

    const result = await arriveCrews({ query }, multipliers);

    expect(result).toEqual({ featureDeltas: [], regionIds: [] });
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
      { task_id: "task-1", status: "done", priority_score: 10, region_id: "region-1" }
    ]);
    expect(result.featureDeltas).toEqual([
      { gers_id: "road-1", health: 80, status: "normal" }
    ]);
    expect(result.rustHexes).toEqual(["hex-1"]);
    expect(result.regionIds).toEqual(["region-1"]);
    expect(result.feedItems[0]?.event_type).toBe("task_complete");
  });
});
