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
      .mockResolvedValueOnce({ rows: [{ exists: "resource_transfers" }] })
      .mockResolvedValueOnce({
        rows: [
          {
            transfer_id: "transfer-1",
            region_id: "region-1",
            source_gers_id: "building-1",
            hub_gers_id: "hub-1",
            resource_type: "labor",
            amount: 5,
            depart_at: new Date().toISOString(),
            arrive_at: new Date().toISOString()
          }
        ]
      });

    const result = await enqueueResourceTransfers({ query }, multipliers);

    expect(result).toHaveLength(1);
    expect(query).toHaveBeenCalledTimes(2);
    expect(String(query.mock.calls[1][0])).toContain("INSERT INTO resource_transfers");
    expect(query.mock.calls[1][1][0]).toBe(1.5);
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
