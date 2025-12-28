import { describe, expect, it, vi } from "vitest";
import { applyRoadDecay } from "./decay";
import { HEALTH_BUCKET_SIZE } from "@nightfall/config";

const multipliers = {
  rust_spread: 1,
  decay: 0.2,
  generation: 1,
  repair_speed: 1
};

describe("applyRoadDecay", () => {
  it("issues a decay update", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    const result = await applyRoadDecay({ query }, multipliers);

    expect(result).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0][0])).toContain("UPDATE feature_state");
    expect(String(query.mock.calls[0][0])).toContain("world_feature_hex_cells");
    expect(query.mock.calls[0][1]).toEqual([0.2]);
  });

  it("captures old state for threshold comparison", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await applyRoadDecay({ query }, multipliers);

    const sql = String(query.mock.calls[0][0]);
    // Should have a CTE capturing old state before the update
    expect(sql).toContain("old_state AS");
    expect(sql).toContain("SELECT fs.gers_id, fs.health, fs.status");
  });

  it("filters results to only include notable threshold crossings", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await applyRoadDecay({ query }, multipliers);

    const sql = String(query.mock.calls[0][0]);
    // Should filter by status change OR health bucket crossing
    expect(sql).toContain("o.status != u.status");
    expect(sql).toContain(`floor(o.health / ${HEALTH_BUCKET_SIZE})`);
    expect(sql).toContain(`floor(u.health / ${HEALTH_BUCKET_SIZE})`);
  });

  it("only emits deltas when status changes or health crosses bucket boundary", async () => {
    // Simulate a query result where only threshold-crossing updates are returned
    const mockDeltas = [
      { gers_id: "road1", region_id: "region1", health: 79, status: "degraded" }, // crossed 80 -> 79 (bucket 8 -> 7)
      { gers_id: "road2", region_id: "region1", health: 69, status: "degraded" }, // status changed to degraded
    ];
    const query = vi.fn().mockResolvedValue({ rows: mockDeltas });

    const result = await applyRoadDecay({ query }, multipliers);

    expect(result).toEqual(mockDeltas);
    expect(result).toHaveLength(2);
  });
});
