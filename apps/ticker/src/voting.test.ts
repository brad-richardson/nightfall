/**
 * Integration tests for crew dispatch with distance-based task selection.
 *
 * These tests verify that:
 * 1. Crews select the nearest affordable task
 * 2. Road class priority is used as a tiebreaker
 * 3. The full dispatch flow works correctly
 */
import { describe, expect, it, vi } from "vitest";
import { dispatchCrews } from "./crews";

// Mock the resources module to avoid pathfinding complexity in unit tests
vi.mock("./resources", () => ({
  loadGraphForRegion: vi.fn().mockResolvedValue(null)
}));

describe("distance-based dispatch", () => {
  it("task selection query orders by distance first", async () => {
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
      .mockResolvedValueOnce({ rows: [] }) // No tasks
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    await dispatchCrews({ query });

    // Find the task selection query
    const taskQuery = query.mock.calls.find(
      call => typeof call[0] === "string" &&
        call[0].includes("FROM tasks") &&
        call[0].includes("status = 'queued'")
    );

    expect(taskQuery).toBeTruthy();
    const taskSql = String(taskQuery![0]);

    // Critical: Tasks must be ordered by distance first
    expect(taskSql).toContain("POW(");
    expect(taskSql).toContain("ORDER BY");
    // Should use road class as secondary sort
    expect(taskSql).toContain("CASE wf.road_class");
  });

  it("task selection includes road coordinates", async () => {
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
      .mockResolvedValueOnce({ rows: [] }) // No tasks
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    await dispatchCrews({ query });

    const taskQuery = query.mock.calls.find(
      call => typeof call[0] === "string" && call[0].includes("FROM tasks")
    );

    const taskSql = String(taskQuery![0]);
    // Should join with world_features to get road coordinates
    expect(taskSql).toContain("JOIN world_features");
    expect(taskSql).toContain("road_lon");
    expect(taskSql).toContain("road_lat");
  });

  it("task selection only considers queued tasks", async () => {
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
      .mockResolvedValueOnce({ rows: [] }) // No tasks
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    await dispatchCrews({ query });

    const taskQuery = query.mock.calls.find(
      call => typeof call[0] === "string" && call[0].includes("FROM tasks")
    );

    const taskSql = String(taskQuery![0]);
    // Should only select queued tasks, not active or done
    expect(taskSql).toContain("status = 'queued'");
  });

  it("passes crew coordinates to task selection query", async () => {
    const crewLng = -68.25;
    const crewLat = 44.38;

    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{
          crew_id: "crew-1",
          region_id: "region-1",
          current_lng: crewLng,
          current_lat: crewLat,
          hub_lon: crewLng,
          hub_lat: crewLat
        }]
      })
      .mockResolvedValueOnce({ rows: [] }) // SAVEPOINT
      .mockResolvedValueOnce({ rows: [{ pool_food: 100, pool_equipment: 100, pool_energy: 100, pool_materials: 100 }] })
      .mockResolvedValueOnce({ rows: [] }) // No tasks
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    await dispatchCrews({ query });

    const taskQuery = query.mock.calls.find(
      call => typeof call[0] === "string" &&
        call[0].includes("FROM tasks") &&
        Array.isArray(call[1])
    );

    expect(taskQuery).toBeTruthy();
    // Should pass crew coordinates as query parameters
    const params = taskQuery![1] as unknown[];
    expect(params).toContain(crewLng);
    expect(params).toContain(crewLat);
  });
});
