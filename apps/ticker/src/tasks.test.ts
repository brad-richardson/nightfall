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
});
