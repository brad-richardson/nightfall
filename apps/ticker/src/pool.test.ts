import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";
import { attachPoolErrorHandler } from "./pool";

describe("attachPoolErrorHandler", () => {
  it("logs pool errors instead of crashing", () => {
    const pool = new EventEmitter() as EventEmitter & {
      on: (event: "error", handler: (err: Error) => void) => void;
    };
    const logger = { info: vi.fn(), error: vi.fn() };

    attachPoolErrorHandler(pool, logger);

    const error = new Error("connection dropped");
    pool.emit("error", error);

    expect(logger.error).toHaveBeenCalledWith({ err: error }, "[ticker] pool error");
  });
});
