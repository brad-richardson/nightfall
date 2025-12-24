import { describe, expect, it } from "vitest";
import { buildServer } from "../server";
import type { EventStream } from "../event-stream";

const eventPayload = {
  event: "phase_change",
  data: {
    phase: "night",
    next_phase: "dawn",
    next_phase_in_seconds: 120
  }
} as const;

describe("event stream", () => {
  it("streams events over SSE", async () => {
    const eventStream: EventStream = {
      subscribe: (handler) => {
        handler(eventPayload);
        return () => {};
      }
    };

    const app = buildServer({ eventStream });
    const response = await app.inject({
      method: "GET",
      url: "/api/stream",
      headers: { "x-sse-once": "1" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.body).toContain("event: phase_change");
    expect(response.body).toContain("\"phase\":\"night\"");

    await app.close();
  });
});
