import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createDbEventStream } from "../event-stream";
import type { Pool, PoolClient } from "pg";
import { EventEmitter } from "node:events";

describe("createDbEventStream", () => {
  let mockPool: Pool;
  let mockClient: PoolClient;
  let logger: { error: ReturnType<typeof vi.fn> };
  let timers: number[];

  beforeEach(() => {
    vi.useFakeTimers();
    timers = [];

    mockClient = new EventEmitter() as unknown as PoolClient;
    (mockClient as any).query = vi.fn().mockResolvedValue({ rows: [] });
    (mockClient as any).release = vi.fn();
    (mockClient as any).removeAllListeners = vi.fn();

    mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient)
    } as unknown as Pool;

    logger = {
      error: vi.fn()
    };

    // Track setTimeout calls
    const originalSetTimeout = global.setTimeout;
    vi.spyOn(global, "setTimeout").mockImplementation((fn: any, delay: number) => {
      const id = originalSetTimeout(fn, delay) as unknown as number;
      timers.push(id);
      return id;
    });
  });

  afterEach(() => {
    timers.forEach(clearTimeout);
    vi.useRealTimers();
  });

  it("creates event stream and starts listening", async () => {
    const eventStream = createDbEventStream(mockPool, logger);
    await eventStream.start?.();

    expect(mockPool.connect).toHaveBeenCalledTimes(1);
    expect((mockClient as any).query).toHaveBeenCalledWith("LISTEN phase_change");
    expect((mockClient as any).query).toHaveBeenCalledWith("LISTEN world_delta");
  });

  it("emits events when notification is received", async () => {
    const eventStream = createDbEventStream(mockPool, logger);
    const handler = vi.fn();
    eventStream.subscribe(handler);

    await eventStream.start?.();

    (mockClient as any).emit("notification", {
      channel: "phase_change",
      payload: JSON.stringify({ phase: "night" })
    });

    expect(handler).toHaveBeenCalledWith({
      event: "phase_change",
      data: { phase: "night" }
    });
  });

  it("triggers reconnection on client error", async () => {
    const eventStream = createDbEventStream(mockPool, logger);
    await eventStream.start?.();

    const firstClient = mockPool.connect as ReturnType<typeof vi.fn>;
    expect(firstClient).toHaveBeenCalledTimes(1);

    // Simulate client error
    (mockClient as any).emit("error", new Error("Connection lost"));

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "event stream db error - triggering reconnect"
    );

    // Advance timers to trigger reconnection
    await vi.advanceTimersByTimeAsync(5000);

    expect(firstClient).toHaveBeenCalledTimes(2);
  });

  it("triggers reconnection on client end", async () => {
    const eventStream = createDbEventStream(mockPool, logger);
    await eventStream.start?.();

    const firstClient = mockPool.connect as ReturnType<typeof vi.fn>;
    expect(firstClient).toHaveBeenCalledTimes(1);

    // Simulate connection end
    (mockClient as any).emit("end");

    expect(logger.error).toHaveBeenCalledWith(
      "event stream db connection ended - triggering reconnect"
    );

    // Advance timers to trigger reconnection
    await vi.advanceTimersByTimeAsync(5000);

    expect(firstClient).toHaveBeenCalledTimes(2);
  });

  it("sets up heartbeat interval", async () => {
    const eventStream = createDbEventStream(mockPool, logger);
    await eventStream.start?.();

    const queryMock = (mockClient as any).query as ReturnType<typeof vi.fn>;
    const initialCallCount = queryMock.mock.calls.length;

    // Advance time by 30 seconds to trigger heartbeat
    await vi.advanceTimersByTimeAsync(30000);

    // Should have called SELECT 1 for heartbeat
    expect(queryMock).toHaveBeenCalledWith("SELECT 1");
    expect(queryMock.mock.calls.length).toBeGreaterThan(initialCallCount);
  });

  it("triggers reconnection on heartbeat failure", async () => {
    const eventStream = createDbEventStream(mockPool, logger);
    await eventStream.start?.();

    const firstClient = mockPool.connect as ReturnType<typeof vi.fn>;
    expect(firstClient).toHaveBeenCalledTimes(1);

    // Make heartbeat query fail
    const queryMock = (mockClient as any).query as ReturnType<typeof vi.fn>;
    queryMock.mockRejectedValueOnce(new Error("Heartbeat failed"));

    // Advance time by 30 seconds to trigger heartbeat
    await vi.advanceTimersByTimeAsync(30000);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "heartbeat failed - triggering reconnect"
    );

    // Advance time for reconnection
    await vi.advanceTimersByTimeAsync(5000);

    expect(firstClient).toHaveBeenCalledTimes(2);
  });

  it("properly cleans up on stop", async () => {
    const eventStream = createDbEventStream(mockPool, logger);
    await eventStream.start?.();

    await eventStream.stop?.();

    expect((mockClient as any).query).toHaveBeenCalledWith("UNLISTEN phase_change");
    expect((mockClient as any).query).toHaveBeenCalledWith("UNLISTEN world_delta");
    expect((mockClient as any).release).toHaveBeenCalled();
  });

  it("handles invalid JSON payload gracefully", async () => {
    const eventStream = createDbEventStream(mockPool, logger);
    const handler = vi.fn();
    eventStream.subscribe(handler);

    await eventStream.start?.();

    (mockClient as any).emit("notification", {
      channel: "phase_change",
      payload: "invalid json {"
    });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "invalid event payload"
    );

    expect(handler).toHaveBeenCalledWith({
      event: "phase_change",
      data: {}
    });
  });

  it("does not start twice if already listening", async () => {
    const eventStream = createDbEventStream(mockPool, logger);

    await eventStream.start?.();
    await eventStream.start?.();

    expect(mockPool.connect).toHaveBeenCalledTimes(1);
  });
});
