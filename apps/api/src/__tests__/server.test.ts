import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../server";

let queryMock = vi.fn();
const closePoolMock = vi.fn();

vi.mock("../db", () => ({
  getPool: () => ({ query: queryMock }),
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

  it("rejects hello without client_id", async () => {
    const app = buildServer();
    const response = await app.inject({ method: "POST", url: "/api/hello", payload: {} });

    expect(response.statusCode).toBe(400);
    const json = response.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBe("missing_field");
    expect(json.field).toBe("client_id");

    await app.close();
  });

  it("returns hello payload with seeded values", async () => {
    // Mock cycle_start to be exactly at the start of a cycle
    const cycleStart = new Date();

    queryMock
      .mockResolvedValueOnce({ rows: [] }) // upsert player
      .mockResolvedValueOnce({ rows: [{ home_region_id: null }] }) // get player
      .mockResolvedValueOnce({ rows: [{ version: "7" }] }) // world version
      .mockResolvedValueOnce({
        rows: [
          {
            region_id: "region-1",
            name: "Alpha",
            center: { type: "Point", coordinates: [0, 0] }
          }
        ]
      }) // regions
      .mockResolvedValueOnce({ rows: [{ cycle_start: cycleStart }] }); // cycle state

    const app = buildServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/hello",
      payload: { client_id: "client-1" }
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.ok).toBe(true);
    expect(json.world_version).toBe(7);
    expect(json.home_region_id).toBe(null);
    expect(json.regions).toEqual([
      {
        region_id: "region-1",
        name: "Alpha",
        center: { type: "Point", coordinates: [0, 0] }
      }
    ]);
    // Cycle state is computed dynamically, so just check structure
    expect(json.cycle).toHaveProperty("phase");
    expect(json.cycle).toHaveProperty("phase_progress");
    expect(json.cycle).toHaveProperty("next_phase_in_seconds");
    expect(["dawn", "day", "dusk", "night"]).toContain(json.cycle.phase);

    expect(queryMock).toHaveBeenCalledTimes(5);

    await app.close();
  });
});
