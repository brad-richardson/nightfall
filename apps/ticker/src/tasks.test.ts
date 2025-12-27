import { describe, expect, it, vi } from "vitest";
import { spawnDegradedRoadTasks, updateTaskPriorities } from "./tasks";

describe("spawnDegradedRoadTasks", () => {
  it("inserts tasks for degraded roads", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ task_id: "task-1", status: "queued", priority_score: 0 }] });

    const result = await spawnDegradedRoadTasks({ query });

    expect(result).toEqual([{ task_id: "task-1", status: "queued", priority_score: 0 }]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0][0])).toContain("INSERT INTO tasks");
    expect(String(query.mock.calls[0][0])).toContain("fs.status = 'degraded'");
  });

  it("calculates initial priority_score based on road health and class weight", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await spawnDegradedRoadTasks({ query });

    // Verify the SQL includes health-based priority calculation
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("(100 - fs.health)");
    expect(sql).toContain("CASE wf.road_class");
    // Should NOT be hardcoded to 0
    expect(sql).not.toMatch(/priority_score,\s*vote_score,\s*status\s*\)\s*SELECT[^)]+0,\s*0,\s*'queued'/s);
  });
});

describe("updateTaskPriorities", () => {
  it("updates tasks with vote decay and base priority", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ task_id: "task-1", status: "queued", priority_score: 10 }] });

    const result = await updateTaskPriorities({ query }, 0.1);

    expect(result).toEqual([{ task_id: "task-1", status: "queued", priority_score: 10 }]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0][0])).toContain("UPDATE tasks");
    expect(query.mock.calls[0][1]).toEqual([0.1]);
  });

  it("includes vote_score in priority calculation", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await updateTaskPriorities({ query }, 0.1);

    const sql = String(query.mock.calls[0][0]);
    // Verify vote_score is added to priority_score
    expect(sql).toContain("+ task_info.vote_score");
    // Verify vote decay formula is used
    expect(sql).toContain("EXP(-$1::float");
    expect(sql).toContain("FROM task_votes");
  });

  it("applies exponential decay to older votes", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await updateTaskPriorities({ query }, 0.1);

    const sql = String(query.mock.calls[0][0]);
    // Verify the decay formula includes time-based calculation
    expect(sql).toContain("EXTRACT(EPOCH FROM (now() - created_at");
    expect(sql).toContain("/ 3600.0"); // Hourly decay
  });
});
