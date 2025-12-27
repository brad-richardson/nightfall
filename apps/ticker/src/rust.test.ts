import * as h3 from "h3-js";
import { describe, expect, it, vi } from "vitest";
import { applyRustSpread, computeRustUpdates } from "./rust";

type LatLngToCell = (lat: number, lng: number, res: number) => string;
type GridDisk = (index: string, k: number) => string[];

const multipliers = {
  rust_spread: 1,
  decay: 1,
  generation: 1,
  repair_speed: 1
};

describe("computeRustUpdates", () => {
  it("spreads toward higher neighbors and applies pushback", () => {
    const cells = [
      { h3_index: "a", region_id: "test", rust_level: 0.2, distance_from_center: 1 },
      { h3_index: "b", region_id: "test", rust_level: 0.6, distance_from_center: 1 }
    ];
    const roadStats = new Map([
      ["b", { healthy: 1, total: 1 }]
    ]);
    const updates = computeRustUpdates({
      cells,
      roadStats,
      multipliers,
      baseSpread: 0.01,
      getNeighbors: (index) => (index === "a" ? ["b"] : ["a"])
    });

    const aUpdate = updates.find((update) => update.h3_index === "a");
    const bUpdate = updates.find((update) => update.h3_index === "b");

    expect(aUpdate?.rust_level).toBeCloseTo(0.204, 3);
    expect(bUpdate?.rust_level).toBeCloseTo(0.5975, 4);
  });

  it("does not spread into center cells", () => {
    const cells = [{ h3_index: "center", region_id: "test", rust_level: 0.4, distance_from_center: 0 }];
    const updates = computeRustUpdates({
      cells,
      roadStats: new Map(),
      multipliers,
      baseSpread: 0.01,
      getNeighbors: () => ["neighbor"]
    });

    expect(updates).toEqual([]);
  });
});

describe("applyRustSpread", () => {
  it("skips update when there are no cells", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });

    const result = await applyRustSpread({ query }, multipliers);

    expect(result).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("uses SELECT FOR UPDATE to prevent race conditions", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });

    await applyRustSpread({ query }, multipliers);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("FOR UPDATE")
    );
  });

  it("issues update when rust changes", async () => {
    const latLngToCell =
      (h3 as { latLngToCell?: LatLngToCell; geoToH3?: LatLngToCell })
        .latLngToCell ?? (h3 as { geoToH3?: LatLngToCell }).geoToH3;
    const gridDisk =
      (h3 as { gridDisk?: GridDisk; kRing?: GridDisk }).gridDisk ??
      (h3 as { kRing?: GridDisk }).kRing;

    if (!latLngToCell || !gridDisk) {
      throw new Error("h3-js helpers missing");
    }

    const baseCell = latLngToCell(37.775, -122.418, 9) as string;
    const neighbors = gridDisk(baseCell, 1) as string[];
    const neighborCell = neighbors.find((cell) => cell !== baseCell);

    if (!neighborCell) {
      throw new Error("no neighbor cell found");
    }

    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          { h3_index: baseCell, region_id: "test", rust_level: 0.2, distance_from_center: 1 },
          { h3_index: neighborCell, region_id: "test", rust_level: 0.6, distance_from_center: 1 }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await applyRustSpread({ query }, multipliers);

    expect(result.some((update) => update.h3_index === baseCell)).toBe(true);
    expect(query).toHaveBeenCalledTimes(3);
    expect(String(query.mock.calls[2][0])).toContain("UPDATE hex_cells");
  });
});
