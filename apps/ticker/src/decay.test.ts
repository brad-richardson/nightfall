import { describe, expect, it, vi } from "vitest";
import { applyRoadDecay } from "./decay";

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
});
