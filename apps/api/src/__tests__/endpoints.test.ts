import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../server";

let queryMock = vi.fn();
const closePoolMock = vi.fn();

vi.mock("../db", () => ({
  getPool: () => ({ query: (...args: unknown[]) => queryMock(...args) }),
  closePool: () => closePoolMock()
}));

describe("api endpoints", () => {
  beforeEach(() => {
    queryMock = vi.fn();
    closePoolMock.mockClear();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it("returns world summary", async () => {
    queryMock.mockImplementation((text: string) => {
      if (text.includes("SELECT key, value FROM world_meta")) {
        return Promise.resolve({
          rows: [
            { key: "last_reset", value: { ts: "2025-01-01T00:00:00Z", version: 2 } },
            { key: "demo_mode", value: { enabled: true } }
          ]
        });
      }
      if (text.includes("cycle_state")) {
        return Promise.resolve({
          rows: [
            {
              cycle_start: "2025-01-01T00:00:00Z",
              phase_start: "2025-01-01T00:00:00Z"
            }
          ]
        });
      }
      if (text.includes("FROM regions AS r")) {
        return Promise.resolve({
          rows: [
            {
              region_id: "region-1",
              name: "Alpha",
              center: { type: "Point", coordinates: [0, 0] },
              pool_labor: 10,
              pool_materials: 20,
              crew_count: 2,
              active_crews: 1,
              rust_avg: 0.1,
              health_avg: 90
            }
          ]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const app = buildServer();
    const response = await app.inject({ method: "GET", url: "/api/world" });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.world_version).toBe(2);
    expect(payload.demo_mode).toBe(true);
    expect(payload.regions).toHaveLength(1);
    expect(payload.cycle.phase).toBeDefined();

    await app.close();
  });

  it("returns region detail", async () => {
    queryMock.mockImplementation((text: string) => {
      if (text.includes("FROM regions")) {
        return Promise.resolve({
          rows: [
            {
              region_id: "region-1",
              name: "Alpha",
              boundary: { type: "Polygon", coordinates: [] },
              pool_labor: 10,
              pool_materials: 20
            }
          ]
        });
      }
      if (text.includes("FROM crews")) {
        return Promise.resolve({ rows: [{ crew_id: "crew-1", status: "idle" }] });
      }
      if (text.includes("FROM tasks")) {
        return Promise.resolve({ rows: [] });
      }
      if (text.includes("COUNT(*) FILTER")) {
        return Promise.resolve({ rows: [{ total_roads: 1, healthy_roads: 1, degraded_roads: 0 }] });
      }
      if (text.includes("FROM hex_cells")) {
        return Promise.resolve({ rows: [{ rust_avg: 0.1 }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const app = buildServer();
    const response = await app.inject({ method: "GET", url: "/api/region/region-1" });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.region_id).toBe("region-1");
    expect(payload.crews).toHaveLength(1);
    expect(payload.stats.total_roads).toBe(1);

    await app.close();
  });

  it("returns features within bbox", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          gers_id: "road-1",
          feature_type: "road",
          geom: { type: "LineString", coordinates: [] },
          health: 80,
          status: "normal",
          road_class: "primary",
          place_category: null,
          generates_labor: false,
          generates_materials: false
        }
      ]
    });

    const app = buildServer();
    const response = await app.inject({
      method: "GET",
      url: "/api/features?bbox=-71,42,-70,43&types=road"
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.features).toHaveLength(1);

    await app.close();
  });

  it("returns hexes within bbox", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ h3_index: "hex-1", rust_level: 0.2, boundary: { type: "Polygon", coordinates: [] } }]
    });

    const app = buildServer();
    const response = await app.inject({ method: "GET", url: "/api/hexes?bbox=-71,42,-70,43" });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.hexes).toHaveLength(1);

    await app.close();
  });

  it("sets home region for a player", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ home_region_id: "region-1" }] });

    const app = buildServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/set-home",
      payload: { client_id: "client-1", region_id: "region-1" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, home_region_id: "region-1" });

    await app.close();
  });

  it("accepts contributions", async () => {
    queryMock.mockImplementation((text: string) => {
      if (text === "BEGIN" || text === "COMMIT") {
        return Promise.resolve({ rows: [] });
      }
      if (text.includes("FROM players")) {
        return Promise.resolve({ rows: [{ home_region_id: "region-1" }] });
      }
      if (text.includes("FROM events")) {
        return Promise.resolve({ rows: [{ labor_used: 0, materials_used: 0 }] });
      }
      if (text.includes("UPDATE regions")) {
        return Promise.resolve({ rows: [{ pool_labor: 110, pool_materials: 120 }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const app = buildServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/contribute",
      payload: { client_id: "client-1", region_id: "region-1", labor: 10, materials: 20 }
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.applied_labor).toBe(10);
    expect(payload.new_pool_labor).toBe(110);

    await app.close();
  });

  it("accepts task votes", async () => {
    queryMock.mockImplementation((text: string) => {
      if (text.includes("INSERT INTO task_votes")) {
        return Promise.resolve({ rows: [] });
      }
      if (text.includes("FROM task_votes")) {
        return Promise.resolve({ rows: [{ vote_score: 2 }] });
      }
      if (text.includes("UPDATE tasks")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const app = buildServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/vote",
      payload: { client_id: "client-1", task_id: "task-1", weight: 1 }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, new_vote_score: 2 });

    await app.close();
  });

  it("returns task detail", async () => {
    queryMock.mockImplementation((text: string) => {
      if (text.includes("FROM tasks")) {
        return Promise.resolve({
          rows: [
            {
              task_id: "task-1",
              target_gers_id: "road-1",
              task_type: "repair_road",
              priority_score: 10,
              vote_score: 2,
              status: "queued",
              duration_s: 50,
              created_at: "2025-01-01T00:00:00Z",
              road_class: "primary",
              health: 50
            }
          ]
        });
      }
      if (text.includes("FROM task_votes")) {
        return Promise.resolve({ rows: [{ vote_score: 2 }] });
      }
      if (text.includes("FROM crews")) {
        return Promise.resolve({ rows: [{ busy_until: null }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const app = buildServer();
    const response = await app.inject({ method: "GET", url: "/api/tasks/task-1" });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.task_id).toBe("task-1");
    expect(payload.votes).toBe(2);

    await app.close();
  });
});
