import { describe, expect, it, vi } from "vitest";
import { cleanupOldData } from "./cleanup";

describe("cleanupOldData", () => {
  it("deletes old events and resource transfers and resets orphaned tasks", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 3 })
      .mockResolvedValueOnce({ rowCount: 5 })
      .mockResolvedValueOnce({ rowCount: 2 });

    const result = await cleanupOldData({ query });

    expect(query).toHaveBeenCalledTimes(3);
    expect(String(query.mock.calls[0][0])).toContain("DELETE FROM events");
    expect(String(query.mock.calls[0][0])).toContain("make_interval");
    expect(String(query.mock.calls[1][0])).toContain("DELETE FROM resource_transfers");
    expect(String(query.mock.calls[2][0])).toContain("UPDATE tasks");
    expect(result).toEqual({ eventsDeleted: 3, transfersDeleted: 5, orphanedTasksReset: 2 });
  });
});
