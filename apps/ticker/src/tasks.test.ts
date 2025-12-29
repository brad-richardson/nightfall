import { describe, expect, it, vi } from "vitest";
import { spawnDegradedRoadTasks, updateTaskPriorities, buildCostCase } from "./tasks";
import { ROAD_CLASSES, RESOURCE_TYPES } from "@nightfall/config";

describe("spawnDegradedRoadTasks", () => {
  it("inserts tasks for degraded roads", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ task_id: "task-1", status: "queued", priority_score: 0 }] });

    const result = await spawnDegradedRoadTasks({ query });

    expect(result).toEqual([{ task_id: "task-1", status: "queued", priority_score: 0 }]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0][0])).toContain("INSERT INTO tasks");
    expect(String(query.mock.calls[0][0])).toContain("fs.health < 70");
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
  it("updates tasks with health and road class based priority", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ task_id: "task-1", status: "queued", priority_score: 10 }] });

    const result = await updateTaskPriorities({ query });

    expect(result).toEqual([{ task_id: "task-1", status: "queued", priority_score: 10 }]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0][0])).toContain("UPDATE tasks");
  });

  it("calculates priority based on health and road class", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await updateTaskPriorities({ query });

    const sql = String(query.mock.calls[0][0]);
    // Verify priority calculation uses health and road class
    expect(sql).toContain("(100 - task_info.health)");
    expect(sql).toContain("CASE task_info.road_class");
  });
});

describe("buildCostCase", () => {
  it("generates deterministic SQL for each resource type", () => {
    const foodCase = buildCostCase("food");
    const foodCase2 = buildCostCase("food");

    // Same input should produce identical output
    expect(foodCase).toBe(foodCase2);
  });

  it("generates different SQL for different resource types", () => {
    const foodCase = buildCostCase("food");
    const materialsCase = buildCostCase("materials");

    // Different resource types should produce different SQL (different hash inputs)
    expect(foodCase).not.toBe(materialsCase);
    expect(foodCase).toContain("'food'");
    expect(materialsCase).toContain("'materials'");
  });

  it("includes all road classes in the generated SQL", () => {
    const sql = buildCostCase("food");

    for (const roadClass of Object.keys(ROAD_CLASSES)) {
      expect(sql).toContain(`WHEN '${roadClass}'`);
    }
  });

  it("generates costs within expected range for each road class", () => {
    const sql = buildCostCase("food");

    for (const [cls, info] of Object.entries(ROAD_CLASSES)) {
      // The formula should be: baseCost + (abs(hash) % range) - variance
      // where range = 2 * variance + 1
      const range = 2 * info.costVariance + 1;
      expect(sql).toContain(
        `WHEN '${cls}' THEN ${info.baseCost} + (abs(hashtext(wf.gers_id || 'food')) % ${range}) - ${info.costVariance}`
      );
    }
  });

  it("throws error for invalid resource type", () => {
    // @ts-expect-error - Testing runtime validation
    expect(() => buildCostCase("invalid")).toThrow(
      "Invalid resourceType: invalid. Must be one of: food, equipment, energy, materials"
    );
  });

  it("accepts all valid resource types", () => {
    for (const resourceType of RESOURCE_TYPES) {
      expect(() => buildCostCase(resourceType)).not.toThrow();
    }
  });
});
