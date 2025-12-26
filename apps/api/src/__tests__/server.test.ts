import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../server";

let queryMock = vi.fn();
const closePoolMock = vi.fn();

vi.mock("../db", () => ({
  getPool: () => ({ query: (...args: unknown[]) => queryMock(...args) }),
  closePool: () => closePoolMock()
}));

describe("api server", () => {
  beforeEach(() => {
    queryMock = vi.fn();
    closePoolMock.mockClear();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.APP_VERSION;
  });

  it("returns health with db unchecked when no DATABASE_URL", async () => {
    delete process.env.DATABASE_URL;
    const app = buildServer();
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, db: { ok: true, checked: false } });

    await app.close();
  });

  it("returns version payload", async () => {
    process.env.APP_VERSION = "test";
    const app = buildServer();
    const response = await app.inject({ method: "GET", url: "/version" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, service: "api", version: "test" });

    await app.close();
  });

  it("does not set CORS headers", async () => {
    const app = buildServer();
    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "http://example.com" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();

    await app.close();
  });

  it("rejects hello without client_id", async () => {
    const app = buildServer();
    const response = await app.inject({ method: "POST", url: "/api/hello", payload: {} });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ ok: false, error: "client_id_required" });

    await app.close();
  });

  it("returns hello payload with seeded values", async () => {
    const now = new Date();
    const cycleStart = new Date(now.getTime() - 3 * 60 * 1000).toISOString();

    queryMock.mockImplementation((text: string) => {
      if (text.includes("INSERT INTO players")) {
        return Promise.resolve({ rows: [] });
      }
      if (text.includes("SELECT home_region_id")) {
        return Promise.resolve({ rows: [{ home_region_id: null }] });
      }
      if (text.includes("value->>'version'")) {
        return Promise.resolve({ rows: [{ version: "7" }] });
      }
      if (text.includes("FROM regions")) {
        return Promise.resolve({
          rows: [
            {
              region_id: "region-1",
              name: "Alpha",
              center: { type: "Point", coordinates: [0, 0] }
            }
          ]
        });
      }
      if (text.includes("cycle_state")) {
        return Promise.resolve({ rows: [{ cycle_start: cycleStart }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const app = buildServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/hello",
      payload: { client_id: "client-1" }
    });

    const payload = response.json();

    expect(response.statusCode).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.world_version).toBe(7);
    expect(payload.home_region_id).toBeNull();
    expect(payload.regions).toEqual([
      {
        region_id: "region-1",
        name: "Alpha",
        center: { type: "Point", coordinates: [0, 0] }
      }
    ]);
    expect(payload.cycle.phase).toBe("day");
    expect(payload.cycle.phase_progress).toBeGreaterThan(0.1);
    expect(payload.cycle.phase_progress).toBeLessThan(0.2);
    expect(payload.cycle.next_phase_in_seconds).toBeGreaterThan(300);
    expect(payload.cycle.next_phase_in_seconds).toBeLessThan(480);

    expect(queryMock).toHaveBeenCalled();

    await app.close();
  });
});
