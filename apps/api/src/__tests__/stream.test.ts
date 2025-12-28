import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../server";
import { resetConfig } from "../config";
import type { EventStream } from "../event-stream";

const eventPayload = {
  event: "phase_change",
  data: {
    phase: "night",
    next_phase: "dawn",
    next_phase_in_seconds: 120
  }
} as const;

function createEventStream(): EventStream {
  return {
    subscribe: (handler) => {
      handler(eventPayload);
      return () => {};
    }
  };
}

describe("event stream", () => {
  it("streams events over SSE", async () => {
    const app = buildServer({ eventStream: createEventStream() });
    const response = await app.inject({
      method: "GET",
      url: "/api/stream",
      headers: { "x-sse-once": "1" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["pragma"]).toBe("no-cache");
    expect(response.body).toContain("event: phase_change");
    expect(response.body).toContain("\"phase\":\"night\"");

    await app.close();
  });

  it("sets CORS headers for allowed origins", async () => {
    const app = buildServer({ eventStream: createEventStream() });
    const response = await app.inject({
      method: "GET",
      url: "/api/stream",
      headers: {
        "x-sse-once": "1",
        origin: "https://brad-richardson.github.io"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "https://brad-richardson.github.io"
    );
    expect(response.headers["access-control-allow-credentials"]).toBe("true");

    await app.close();
  });

  it("does not set CORS headers for disallowed origins", async () => {
    const app = buildServer({ eventStream: createEventStream() });
    const response = await app.inject({
      method: "GET",
      url: "/api/stream",
      headers: {
        "x-sse-once": "1",
        origin: "https://evil.example.com"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();

    await app.close();
  });

  it("does not set CORS headers when no origin header present", async () => {
    const app = buildServer({ eventStream: createEventStream() });
    const response = await app.inject({
      method: "GET",
      url: "/api/stream",
      headers: { "x-sse-once": "1" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();

    await app.close();
  });
});

describe("event stream CORS with empty ALLOWED_ORIGINS", () => {
  const originalEnv = process.env.ALLOWED_ORIGINS;

  beforeEach(() => {
    // Set to empty string to trigger "allow all" behavior
    process.env.ALLOWED_ORIGINS = "";
    resetConfig();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ALLOWED_ORIGINS = originalEnv;
    } else {
      delete process.env.ALLOWED_ORIGINS;
    }
    resetConfig();
  });

  it("allows all origins when ALLOWED_ORIGINS is empty", async () => {
    const app = buildServer({ eventStream: createEventStream() });
    const response = await app.inject({
      method: "GET",
      url: "/api/stream",
      headers: {
        "x-sse-once": "1",
        origin: "https://any-origin.example.com"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "https://any-origin.example.com"
    );
    expect(response.headers["access-control-allow-credentials"]).toBe("true");

    await app.close();
  });
});
