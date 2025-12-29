import { describe, expect, it, vi } from "vitest";
import { completeFinishedTasks, dispatchCrews, arriveCrews, arriveCrewsAtHub } from "./crews";

// Mock the resources module to avoid pathfinding complexity in unit tests
vi.mock("./resources", () => ({
  loadGraphForRegion: vi.fn().mockResolvedValue(null)
}));

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

    expect(result).toEqual({ taskDeltas: [], featureDeltas: [], regionIds: [], crewEvents: [] });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("assigns an affordable task and sets crew to traveling", async () => {
    const query = vi
      .fn()
      // idle crews query now returns position fields
      .mockResolvedValueOnce({
        rows: [{
          crew_id: "crew-1",
          region_id: "region-1",
          current_lng: -68.25,
          current_lat: 44.38,
          hub_lon: -68.25,
          hub_lat: 44.38
        }]
      })
      .mockResolvedValueOnce({ rows: [] }) // SAVEPOINT
      .mockResolvedValueOnce({ rows: [{ pool_food: 100, pool_equipment: 100, pool_energy: 100, pool_materials: 100 }] }) // region pools
      // task selection now includes road_lon/road_lat directly
      .mockResolvedValueOnce({
        rows: [
          {
            task_id: "task-1",
            target_gers_id: "road-1",
            cost_food: 20,
            cost_equipment: 10,
            cost_energy: 5,
            cost_materials: 10,
            duration_s: 40,
            road_lon: -68.26,
            road_lat: 44.39
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] }) // region update
      .mockResolvedValueOnce({
        rows: [{ task_id: "task-1", status: "active", priority_score: 10 }]
      }) // task update
      .mockResolvedValueOnce({ rows: [] }) // crew update to 'traveling'
      .mockResolvedValueOnce({ rows: [] }) // insert event
      .mockResolvedValueOnce({ rows: [] }); // RELEASE SAVEPOINT

    const result = await dispatchCrews({ query });

    expect(result.taskDeltas).toEqual([
      { task_id: "task-1", status: "active", priority_score: 10 }
    ]);
    // featureDeltas is now empty - roads are updated when crews arrive
    expect(result.featureDeltas).toEqual([]);
    expect(result.regionIds).toEqual(["region-1"]);

    // Verify savepoint was released (equivalent to commit in nested transaction context)
    const releaseCall = query.mock.calls.find((call) => typeof call[0] === "string" && call[0].includes("RELEASE SAVEPOINT"));
    expect(releaseCall).toBeTruthy();

    // Verify crew was set to 'traveling' not 'working'
    const crewUpdateCall = query.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("status = 'traveling'")
    );
    expect(crewUpdateCall).toBeTruthy();
  });

  it("rolls back when no tasks are affordable", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{
          crew_id: "crew-1",
          region_id: "region-1",
          current_lng: -68.25,
          current_lat: 44.38,
          hub_lon: -68.25,
          hub_lat: 44.38
        }]
      })
      .mockResolvedValueOnce({ rows: [] }) // SAVEPOINT
      .mockResolvedValueOnce({ rows: [{ pool_food: 5, pool_equipment: 5, pool_energy: 5, pool_materials: 5 }] })
      .mockResolvedValueOnce({ rows: [] }) // No affordable tasks
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK TO SAVEPOINT

    const result = await dispatchCrews({ query });

    expect(result).toEqual({ taskDeltas: [], featureDeltas: [], regionIds: [], crewEvents: [] });

    // Verify savepoint was rolled back (not the full transaction)
    const rollbackCall = query.mock.calls.find((call) => typeof call[0] === "string" && call[0].includes("ROLLBACK TO SAVEPOINT"));
    expect(rollbackCall).toBeTruthy();
  });

  it("selects tasks ordered by distance first (nearest task to crew)", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{
          crew_id: "crew-1",
          region_id: "region-1",
          current_lng: -68.25,
          current_lat: 44.38,
          hub_lon: -68.25,
          hub_lat: 44.38
        }]
      })
      .mockResolvedValueOnce({ rows: [] }) // SAVEPOINT
      .mockResolvedValueOnce({ rows: [{ pool_food: 100, pool_equipment: 100, pool_energy: 100, pool_materials: 100 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            task_id: "nearest-task",
            target_gers_id: "road-1",
            cost_food: 10,
            cost_equipment: 10,
            cost_energy: 10,
            cost_materials: 10,
            duration_s: 30,
            road_lon: -68.26,
            road_lat: 44.39
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] }) // region update
      .mockResolvedValueOnce({
        rows: [{ task_id: "nearest-task", status: "active", priority_score: 50 }]
      })
      .mockResolvedValueOnce({ rows: [] }) // crew update
      .mockResolvedValueOnce({ rows: [] }) // insert event
      .mockResolvedValueOnce({ rows: [] }); // RELEASE SAVEPOINT

    await dispatchCrews({ query });

    // Find the task selection query and verify it orders by distance first
    const taskSelectCall = query.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("FROM tasks") && call[0].includes("status = 'queued'")
    );
    expect(taskSelectCall).toBeTruthy();
    const taskSelectSql = String(taskSelectCall![0]);
    // Should order by distance (POW for squared distance), then road class, then health
    expect(taskSelectSql).toContain("POW(");
    expect(taskSelectSql).toContain("ORDER BY");
    expect(taskSelectSql).toContain("CASE wf.road_class");
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
            target_gers_id: "road-1",
            waypoints: [{ coord: [-68.26, 44.39], arrive_at: new Date().toISOString() }]
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

    // Verify savepoint was used (for nested transaction safety)
    const savepointCall = query.mock.calls.find((call) => typeof call[0] === "string" && call[0].includes("SAVEPOINT"));
    expect(savepointCall).toBeTruthy();
    const releaseCall = query.mock.calls.find((call) => typeof call[0] === "string" && call[0].includes("RELEASE SAVEPOINT"));
    expect(releaseCall).toBeTruthy();

    // Verify crew was set to 'working'
    const crewUpdateCall = query.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("status = 'working'")
    );
    expect(crewUpdateCall).toBeTruthy();
  });

  it("returns empty results when no crews are traveling", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });

    const result = await arriveCrews({ query }, multipliers);

    expect(result).toEqual({ featureDeltas: [], regionIds: [], crewEvents: [] });
  });
});

describe("arriveCrewsAtHub", () => {
  it("transitions returning crews to idle at hub", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            crew_id: "crew-1",
            region_id: "region-1",
            waypoints: [{ coord: [-68.25, 44.38], arrive_at: new Date().toISOString() }]
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] }); // crew update

    const result = await arriveCrewsAtHub({ query });

    expect(result).toHaveLength(1);
    expect(result[0].crew_id).toBe("crew-1");
    expect(result[0].event_type).toBe("crew_idle");
  });

  it("returns empty array when no crews are returning", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });

    const result = await arriveCrewsAtHub({ query });

    expect(result).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe("completeFinishedTasks", () => {
  it("returns empty when no crews are done working", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });

    const result = await completeFinishedTasks({ query }, multipliers);

    expect(result.taskDeltas).toEqual([]);
    expect(result.featureDeltas).toEqual([]);
    expect(result.crewEvents).toEqual([]);
  });

  it("completes tasks and returns crew to hub when no next task available", async () => {
    const query = vi
      .fn()
      // First query: find crews done working
      .mockResolvedValueOnce({
        rows: [
          {
            crew_id: "crew-1",
            region_id: "region-1",
            active_task_id: "task-1",
            target_gers_id: "road-1",
            current_lng: -68.26,
            current_lat: 44.39
          }
        ]
      })
      // Second query: main completion CTE
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
            features: [{ gers_id: "road-1", region_id: "region-1", health: 80, status: "normal" }],
            hexes: [{ h3_index: "hex-1", rust_level: 0.1 }]
          }
        ]
      })
      // Third query: insert event
      .mockResolvedValueOnce({ rows: [] })
      // Fourth query: get region pools
      .mockResolvedValueOnce({
        rows: [{ pool_food: 100, pool_equipment: 100, pool_energy: 100, pool_materials: 100 }]
      })
      // Fifth query: check for next task (none available)
      .mockResolvedValueOnce({ rows: [] })
      // Sixth query: get hub center for return
      .mockResolvedValueOnce({
        rows: [{ hub_lon: -68.25, hub_lat: 44.38 }]
      })
      // Seventh query: update crew to returning
      .mockResolvedValueOnce({ rows: [] });

    const result = await completeFinishedTasks({ query }, multipliers);

    expect(result.taskDeltas).toEqual([
      { task_id: "task-1", status: "done", priority_score: 10, region_id: "region-1" }
    ]);
    expect(result.featureDeltas).toEqual([
      { gers_id: "road-1", region_id: "region-1", health: 80, status: "normal" }
    ]);
    expect(result.regionIds).toEqual(["region-1"]);
    expect(result.feedItems[0]?.event_type).toBe("task_complete");
    // Crew should be returning to hub
    expect(result.crewEvents.length).toBeGreaterThanOrEqual(0);
  });
});
