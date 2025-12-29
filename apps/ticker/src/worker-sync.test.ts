import { describe, expect, it, vi } from "vitest";
import { syncRegionWorkers } from "./worker-sync";

describe("syncRegionWorkers", () => {
  it("returns counts of added and removed crews", async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [{ added: 5, removed: 2 }]
    });

    const result = await syncRegionWorkers({ query });

    expect(query).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ added: 5, removed: 2 });
  });

  it("handles empty result gracefully", async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: []
    });

    const result = await syncRegionWorkers({ query });

    expect(result).toEqual({ added: 0, removed: 0 });
  });

  it("uses a single atomic query with CTEs", async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [{ added: 0, removed: 0 }]
    });

    await syncRegionWorkers({ query });

    // Should only call query once (all operations in single CTE query)
    expect(query).toHaveBeenCalledTimes(1);

    // Verify the query contains key CTEs
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("WITH region_stats AS");
    expect(sql).toContain("regions_needing_crews");
    expect(sql).toContain("crews_to_remove");
    expect(sql).toContain("inserted_crews");
    expect(sql).toContain("deleted_crews");
    expect(sql).toContain("updated_regions");
  });

  it("only updates crew_count when it differs from target", async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [{ added: 0, removed: 0 }]
    });

    await syncRegionWorkers({ query });

    const sql = String(query.mock.calls[0][0]);
    // The UPDATE should have a WHERE clause checking for difference
    expect(sql).toContain("r.crew_count != rs.target_crews");
  });

  it("only removes idle crews, never active ones", async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [{ added: 0, removed: 0 }]
    });

    await syncRegionWorkers({ query });

    const sql = String(query.mock.calls[0][0]);
    // Should filter for idle status when selecting crews to remove
    expect(sql).toContain("status = 'idle'");
  });

  it("ensures minimum of 1 crew per region", async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [{ added: 0, removed: 0 }]
    });

    await syncRegionWorkers({ query });

    const sql = String(query.mock.calls[0][0]);
    // Should use GREATEST(1, ...) to ensure minimum of 1
    expect(sql).toContain("GREATEST(1,");
  });
});
