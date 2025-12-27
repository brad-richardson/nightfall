import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  enqueueResourceTransfers,
  applyArrivedResourceTransfers,
  resetResourceTransferCacheForTests
} from "./resources";

const multipliers = {
  rust_spread: 1,
  decay: 1,
  generation: 1.5,
  repair_speed: 1
};

describe("resource transfers", () => {
  beforeEach(() => {
    resetResourceTransferCacheForTests();
  });

  it("enqueues resource transfers based on building output", async () => {
    const query = vi.fn()
      // 1. Table existence check
      .mockResolvedValueOnce({ rows: [{ exists: "resource_transfers" }] })
      // 2. Buildings query - return a building that generates food
      .mockResolvedValueOnce({
        rows: [
          {
            source_gers_id: "building-1",
            region_id: "region-1",
            h3_index: "hex-1",
            hub_gers_id: "hub-1",
            source_lon: -71.0,
            source_lat: 42.0,
            hub_lon: -71.1,
            hub_lat: 42.1,
            food_amount: 5,
            equipment_amount: 0,
            energy_amount: 0,
            materials_amount: 0,
          }
        ]
      })
      // 3. Road connectors query - return empty to skip graph (uses fallback travel time)
      .mockResolvedValueOnce({ rows: [] })
      // 4. INSERT ... RETURNING
      .mockResolvedValueOnce({
        rows: [
          {
            transfer_id: "transfer-1",
            region_id: "region-1",
            source_gers_id: "building-1",
            hub_gers_id: "hub-1",
            resource_type: "food",
            amount: 5,
            depart_at: new Date().toISOString(),
            arrive_at: new Date().toISOString()
          }
        ]
      });

    const result = await enqueueResourceTransfers({ query }, multipliers);

    expect(result).toHaveLength(1);
    expect(query).toHaveBeenCalledTimes(4);
    expect(String(query.mock.calls[3][0])).toContain("INSERT INTO resource_transfers");
  });

  it("applies arrived transfers to region pools", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ exists: "resource_transfers" }] })
      .mockResolvedValueOnce({
        rows: [{ region_id: "region-1" }, { region_id: "region-2" }]
      });

    const result = await applyArrivedResourceTransfers({ query });

    expect(result.regionIds.sort()).toEqual(["region-1", "region-2"]);
    expect(query).toHaveBeenCalledTimes(2);
    expect(String(query.mock.calls[1][0])).toContain("resource_transfers");
  });

  it("skips enqueuing transfers when the table is missing", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ exists: null }] });

    const result = await enqueueResourceTransfers({ query }, multipliers);

    expect(result).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0][0])).toContain("to_regclass");
  });

  it("skips applying transfers when the table is missing", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ exists: null }] });

    const result = await applyArrivedResourceTransfers({ query });

    expect(result.regionIds).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0][0])).toContain("to_regclass");
  });
});
