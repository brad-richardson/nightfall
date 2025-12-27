/**
 * Integration tests for the voting system.
 *
 * These tests verify that:
 * 1. Votes are correctly incorporated into priority_score
 * 2. Higher priority tasks (including those with more votes) get dispatched first
 * 3. The full flow from vote → priority update → dispatch works correctly
 */
import { describe, expect, it, vi } from "vitest";
import { updateTaskPriorities } from "./tasks";
import { dispatchCrews } from "./crews";

// Mock the resources module to avoid pathfinding complexity in unit tests
vi.mock("./resources", () => ({
  loadGraphForRegion: vi.fn().mockResolvedValue(null)
}));

describe("voting integration", () => {
  it("votes increase priority_score causing earlier dispatch", async () => {
    // Scenario: Two tasks with same base health priority, but one has votes
    // The voted task should be dispatched first

    // Step 1: Simulate updateTaskPriorities with votes
    // Task A: health=50, no votes → priority = (100-50)*1 + 0 = 50
    // Task B: health=50, 5 votes → priority = (100-50)*1 + 5 = 55
    const priorityQuery = vi.fn().mockResolvedValue({
      rows: [
        { task_id: "task-a", status: "queued", priority_score: 50, vote_score: 0 },
        { task_id: "task-b", status: "queued", priority_score: 55, vote_score: 5 }
      ]
    });

    const priorityResult = await updateTaskPriorities({ query: priorityQuery }, 0.1);

    // Verify vote_score affects priority
    expect(priorityResult.find(t => t.task_id === "task-b")?.priority_score).toBeGreaterThan(
      priorityResult.find(t => t.task_id === "task-a")?.priority_score ?? 0
    );

    // Step 2: Simulate dispatch - should pick task-b (higher priority due to votes)
    const dispatchQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ crew_id: "crew-1", region_id: "region-1" }] })
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ pool_food: 100, pool_equipment: 100, pool_energy: 100, pool_materials: 100 }] })
      .mockResolvedValueOnce({
        // Returns highest priority task (task-b with votes)
        rows: [{
          task_id: "task-b",
          target_gers_id: "road-b",
          cost_food: 10,
          cost_equipment: 10,
          cost_energy: 10,
          cost_materials: 10,
          duration_s: 30
        }]
      })
      .mockResolvedValueOnce({
        rows: [{ hub_lon: -68.25, hub_lat: 44.38, road_lon: -68.26, road_lat: 44.39 }]
      }) // coordinate query for travel time
      .mockResolvedValueOnce({ rows: [] }) // region update
      .mockResolvedValueOnce({
        rows: [{ task_id: "task-b", status: "active", priority_score: 55 }]
      })
      .mockResolvedValueOnce({ rows: [] }) // crew update
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const dispatchResult = await dispatchCrews({ query: dispatchQuery });

    // The voted task should be dispatched
    expect(dispatchResult.taskDeltas[0]?.task_id).toBe("task-b");
    expect(dispatchResult.taskDeltas[0]?.priority_score).toBe(55);
  });

  it("downvotes decrease priority_score causing later dispatch", async () => {
    // Scenario: Task with negative votes should have lower priority
    // Task A: health=50, -3 votes → priority = 50 + (-3) = 47
    // Task B: health=50, no votes → priority = 50 + 0 = 50
    const priorityQuery = vi.fn().mockResolvedValue({
      rows: [
        { task_id: "task-a", status: "queued", priority_score: 47, vote_score: -3 },
        { task_id: "task-b", status: "queued", priority_score: 50, vote_score: 0 }
      ]
    });

    const priorityResult = await updateTaskPriorities({ query: priorityQuery }, 0.1);

    // Task with downvotes should have lower priority
    expect(priorityResult.find(t => t.task_id === "task-a")?.priority_score).toBeLessThan(
      priorityResult.find(t => t.task_id === "task-b")?.priority_score ?? 0
    );
  });

  it("priority_score formula correctly combines health and votes", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await updateTaskPriorities({ query }, 0.1);

    const sql = String(query.mock.calls[0][0]);

    // Verify the complete priority formula:
    // priority_score = (100 - health) * road_class_weight + vote_score
    expect(sql).toContain("(100 - task_info.health)");
    expect(sql).toContain("CASE task_info.road_class");
    expect(sql).toContain("+ task_info.vote_score");
  });

  it("vote decay uses exponential function with lambda parameter", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const lambda = 0.15; // Custom decay rate

    await updateTaskPriorities({ query }, lambda);

    // Verify lambda is passed to the query
    expect(query.mock.calls[0][1]).toEqual([lambda]);

    const sql = String(query.mock.calls[0][0]);
    // Verify exponential decay formula
    expect(sql).toContain("EXP(-$1::float * EXTRACT(EPOCH FROM");
  });
});

describe("vote-to-dispatch pipeline", () => {
  it("ensures dispatch query orders by priority_score DESC", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ crew_id: "crew-1", region_id: "region-1" }] })
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ pool_food: 100, pool_equipment: 100, pool_energy: 100, pool_materials: 100 }] })
      .mockResolvedValueOnce({ rows: [] }) // No tasks available
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

    // Critical: Tasks must be ordered by priority_score DESC so voted tasks come first
    expect(taskSql).toMatch(/ORDER BY\s+priority_score\s+DESC/);
  });

  it("task selection query only considers queued tasks", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ crew_id: "crew-1", region_id: "region-1" }] })
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
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
});
