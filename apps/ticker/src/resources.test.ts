import { describe, expect, it, vi } from "vitest";
import { generateRegionResources } from "./resources";

const multipliers = {
  rust_spread: 1,
  decay: 1,
  generation: 1.5,
  repair_speed: 1
};

describe("generateRegionResources", () => {
  it("updates regional pools based on building output", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ region_id: "region-1" }] });

    const result = await generateRegionResources({ query }, multipliers);

    expect(result).toEqual(["region-1"]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0][0])).toContain("generates_labor");
    expect(String(query.mock.calls[0][0])).toContain("world_feature_hex_cells");
    expect(query.mock.calls[0][1]).toEqual([1.5]);
  });
});
