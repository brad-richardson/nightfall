import { describe, expect, it, vi } from "vitest";
import { cleanupOldData } from "./cleanup";

describe("cleanupOldData", () => {
  it("deletes old events and resource transfers and resets orphaned tasks and game events", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 3 })  // events
      .mockResolvedValueOnce({ rowCount: 5 })  // resource_transfers
      .mockResolvedValueOnce({ rowCount: 2 })  // orphaned tasks
      .mockResolvedValueOnce({ rowCount: 10 }); // game_events

    const result = await cleanupOldData({ query });

    expect(query).toHaveBeenCalledTimes(4);
    expect(String(query.mock.calls[0][0])).toContain("DELETE FROM events");
    expect(String(query.mock.calls[0][0])).toContain("make_interval");
    expect(String(query.mock.calls[1][0])).toContain("DELETE FROM resource_transfers");
    expect(String(query.mock.calls[2][0])).toContain("UPDATE tasks");
    expect(String(query.mock.calls[3][0])).toContain("DELETE FROM game_events");
    expect(result).toEqual({ eventsDeleted: 3, transfersDeleted: 5, orphanedTasksReset: 2, gameEventsDeleted: 10 });
  });
});
