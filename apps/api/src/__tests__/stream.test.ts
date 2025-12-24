import { describe, expect, it } from "vitest";
import { buildServer } from "../server";
import type { PhaseStream } from "../phase-stream";

const phasePayload = {
  phase: "night",
  next_phase: "dawn",
  next_phase_in_seconds: 120
} as const;

describe("phase stream", () => {
  it("streams phase_change events over SSE", async () => {
    const phaseStream: PhaseStream = {
      subscribe: (handler) => {
        handler(phasePayload);
        return () => {};
      }
    };

    const app = buildServer({ phaseStream });
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
