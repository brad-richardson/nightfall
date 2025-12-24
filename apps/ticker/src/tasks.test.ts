import { describe, expect, it, vi } from "vitest";
import { spawnDegradedRoadTasks, updateTaskPriorities } from "./tasks";

describe("spawnDegradedRoadTasks", () => {
  it("inserts tasks for degraded roads", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await spawnDegradedRoadTasks({ query });

    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0][0])).toContain("INSERT INTO tasks");
    expect(String(query.mock.calls[0][0])).toContain("fs.status = 'degraded'");
  });
});

describe("updateTaskPriorities", () => {
  it("updates tasks with vote decay and base priority", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await updateTaskPriorities({ query }, 0.1);

    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0][0])).toContain("UPDATE tasks");
    expect(query.mock.calls[0][1]).toEqual([0.1]);
  });
});
