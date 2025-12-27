import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createDbEventStream } from "../event-stream";
import type { Pool, PoolClient } from "pg";
import { EventEmitter } from "node:events";

type MockPoolClient = PoolClient & EventEmitter & {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
};

describe("createDbEventStream", () => {
  let mockPool: Pool;
  let mockClient: MockPoolClient;
  let logger: { error: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();

    const emitter = new EventEmitter();
    mockClient = Object.assign(emitter, {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
      removeAllListeners: vi.fn()
    }) as MockPoolClient;

    mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient)
    } as unknown as Pool;

    logger = {
      error: vi.fn()
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates event stream and starts listening", async () => {
    const eventStream = createDbEventStream(mockPool, logger);
    await eventStream.start?.();

    expect(mockPool.connect).toHaveBeenCalledTimes(1);
    expect(mockClient.query).toHaveBeenCalledWith("LISTEN phase_change");
    expect(mockClient.query).toHaveBeenCalledWith("LISTEN world_delta");
  });

  it("emits events when notification is received", async () => {
    const eventStream = createDbEventStream(mockPool, logger);
    const handler = vi.fn();
    eventStream.subscribe(handler);

    await eventStream.start?.();

    mockClient.emit("notification", {
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
    mockClient.emit("error", new Error("Connection lost"));

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
    mockClient.emit("end");

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

    const initialCallCount = mockClient.query.mock.calls.length;

    // Advance time by 30 seconds to trigger heartbeat
    await vi.advanceTimersByTimeAsync(30000);

    // Should have called SELECT 1 for heartbeat
    expect(mockClient.query).toHaveBeenCalledWith("SELECT 1");
    expect(mockClient.query.mock.calls.length).toBeGreaterThan(initialCallCount);
  });

  it("triggers reconnection on heartbeat failure", async () => {
    const eventStream = createDbEventStream(mockPool, logger);
    await eventStream.start?.();

    const firstClient = mockPool.connect as ReturnType<typeof vi.fn>;
    expect(firstClient).toHaveBeenCalledTimes(1);

    // Make heartbeat query fail
    mockClient.query.mockRejectedValueOnce(new Error("Heartbeat failed"));

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

    expect(mockClient.query).toHaveBeenCalledWith("UNLISTEN phase_change");
    expect(mockClient.query).toHaveBeenCalledWith("UNLISTEN world_delta");
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("handles invalid JSON payload gracefully", async () => {
    const eventStream = createDbEventStream(mockPool, logger);
    const handler = vi.fn();
    eventStream.subscribe(handler);

    await eventStream.start?.();

    mockClient.emit("notification", {
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
