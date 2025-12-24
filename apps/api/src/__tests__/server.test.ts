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
    expect(response.json()).toEqual({ ok: false, error: "client_id_required" });

    await app.close();
  });

  it("returns hello payload with seeded values", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ home_region_id: null }] })
      .mockResolvedValueOnce({ rows: [{ version: "7" }] })
      .mockResolvedValueOnce({
        rows: [
          {
            region_id: "region-1",
            name: "Alpha",
            center: { type: "Point", coordinates: [0, 0] }
          }
        ]
      });

    const app = buildServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/hello",
      payload: { client_id: "client-1" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      world_version: 7,
      home_region_id: null,
      regions: [
        {
          region_id: "region-1",
          name: "Alpha",
          center: { type: "Point", coordinates: [0, 0] }
        }
      ],
      cycle: {
        phase: "day",
        phase_progress: 0,
        next_phase_in_seconds: 0
      }
    });

    expect(queryMock).toHaveBeenCalledTimes(4);

    await app.close();
  });
});
