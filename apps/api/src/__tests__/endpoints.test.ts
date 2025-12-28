import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";
import { buildServer, resetOvertureCacheForTests, resetFocusHexCacheForTests } from "../server";

let queryMock = vi.fn();
const closePoolMock = vi.fn();

vi.mock("../db", () => ({
  getPool: () => ({ query: (...args: unknown[]) => queryMock(...args) }),
  closePool: () => closePoolMock()
}));

function getTestToken(clientId: string) {
  const hmac = createHmac("sha256", "dev-secret-do-not-use-in-prod");
  hmac.update(clientId);
  return hmac.digest("hex");
}

describe("api endpoints", () => {
  beforeEach(() => {
    queryMock = vi.fn();
    closePoolMock.mockClear();
    resetOvertureCacheForTests();
    resetFocusHexCacheForTests();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
    vi.unstubAllGlobals();
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
              pool_food: 10,
              pool_equipment: 10,
              pool_energy: 10,
              pool_materials: 20,
              crew_count: 10,
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
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["pragma"]).toBe("no-cache");
    const payload = response.json();
    expect(payload.world_version).toBe(2);
    expect(payload.demo_mode).toBe(true);
    expect(payload.regions).toHaveLength(1);
    expect(payload.cycle.phase).toBeDefined();
    // City score = health × (1 - rust) = 90 × 0.9 = 81
    expect(payload.city_score).toBe(81);
    expect(payload.regions[0].score).toBe(81);

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
              pool_food: 10,
              pool_equipment: 10,
              pool_energy: 10,
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
      // Focus hex query - must check before stats query since both use COUNT(*) FILTER
      if (text.includes("road_counts") && text.includes("degraded_count")) {
        return Promise.resolve({ rows: [{ h3_index: "8a2a10726c9ffff" }] });
      }
      if (text.includes("COUNT(*) FILTER")) {
        return Promise.resolve({
          rows: [{ total_roads: 1, healthy_roads: 1, degraded_roads: 0, health_avg: 95 }]
        });
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
    expect(payload.stats.health_avg).toBe(95);
    expect(payload.focus_h3_index).toBe("8a2a10726c9ffff");

    await app.close();
  });

  it("returns features within bbox", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          gers_id: "road-1",
          feature_type: "road",
          bbox: [-71, 42, -70, 43],
          health: 80,
          status: "normal",
          road_class: "primary",
          place_category: "building_supply_store",
          generates_food: false,
          generates_equipment: false,
          generates_energy: false,
          generates_materials: true
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
    expect(payload.features[0].bbox).toEqual([-71, 42, -70, 43]);
    expect(payload.features[0].generates_materials).toBe(true); // inferred from place_category

    await app.close();
  });

  it("returns features for buildings", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          gers_id: "building-1",
          feature_type: "building",
          bbox: [-71, 42, -70, 43],
          generates_food: true,
          generates_equipment: false,
          generates_energy: false,
          generates_materials: false
        }
      ]
    });

    const app = buildServer();
    const response = await app.inject({
      method: "GET",
      url: "/api/features?bbox=-71,42,-70,43&types=building"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().features).toHaveLength(1);

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
      headers: { authorization: `Bearer ${getTestToken("client-1")}` },
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
        return Promise.resolve({ rows: [{ food_used: 0, equipment_used: 0, energy_used: 0, materials_used: 0 }] });
      }
      if (text.includes("feature_type = 'building'")) {
        return Promise.resolve({
          rows: [{
            gers_id: "building-1",
            h3_index: "hex-1",
            bbox_xmin: 0,
            bbox_xmax: 1,
            bbox_ymin: 0,
            bbox_ymax: 1
          }]
        });
      }
      if (text.includes("FROM world_features AS wf")) {
        return Promise.resolve({
          rows: [{
            gers_id: "hub-1",
            h3_index: "hex-1",
            bbox_xmin: 0,
            bbox_xmax: 1,
            bbox_ymin: 0,
            bbox_ymax: 1
          }]
        });
      }
      if (text.includes("FROM hex_cells AS h")) {
        return Promise.resolve({
          rows: [{
            gers_id: "hub-1",
            bbox_xmin: 0,
            bbox_xmax: 1,
            bbox_ymin: 0,
            bbox_ymax: 1
          }]
        });
      }
      if (text.includes("INSERT INTO resource_transfers")) {
        return Promise.resolve({
          rows: [
            {
              transfer_id: "transfer-1",
              region_id: "region-1",
              source_gers_id: "building-1",
              hub_gers_id: "hub-1",
              resource_type: "food",
              amount: 10,
              depart_at: "2025-01-01T00:00:00Z",
              arrive_at: "2025-01-01T00:00:05Z"
            },
            {
              transfer_id: "transfer-2",
              region_id: "region-1",
              source_gers_id: "building-1",
              hub_gers_id: "hub-1",
              resource_type: "materials",
              amount: 20,
              depart_at: "2025-01-01T00:00:00Z",
              arrive_at: "2025-01-01T00:00:05Z"
            }
          ]
        });
      }
      if (text.includes("UPDATE players SET lifetime_contrib")) {
        return Promise.resolve({ rows: [] });
      }
      if (text.includes("INSERT INTO events")) {
        return Promise.resolve({ rows: [] });
      }
      if (text.includes("pg_notify")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const app = buildServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/contribute",
      headers: { authorization: `Bearer ${getTestToken("client-1")}` },
      payload: {
        client_id: "client-1",
        region_id: "region-1",
        food: 10,
        equipment: 0,
        energy: 0,
        materials: 20,
        source_gers_id: "building-1"
      }
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.applied_food).toBe(10);
    expect(payload.applied_materials).toBe(20);
    expect(payload.transfers).toHaveLength(2);

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
        return Promise.resolve({
          rows: [{
            task_id: "task-1",
            status: "queued",
            priority_score: 5,
            vote_score: 2,
            cost_food: 10,
            cost_equipment: 5,
            cost_energy: 5,
            cost_materials: 10,
            duration_s: 30,
            repair_amount: 5,
            task_type: "repair_road",
            target_gers_id: "road-1",
            region_id: "region-1"
          }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const app = buildServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/vote",
      headers: { authorization: `Bearer ${getTestToken("client-1")}` },
      payload: { client_id: "client-1", task_id: "task-1", weight: 1 }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, new_vote_score: 2, priority_score: 5 });

    await app.close();
  });

  it("returns overture latest and caches it", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        latest: "2025-12-17.0",
        links: [{ rel: "child", href: "./2025-12-17.0/catalog.json", latest: true }]
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const app = buildServer();
    const first = await app.inject({ method: "GET", url: "/api/overture-latest" });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ ok: true, release: "2025-12-17" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await app.inject({ method: "GET", url: "/api/overture-latest" });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ ok: true, release: "2025-12-17" });
    expect(fetchMock).toHaveBeenCalledTimes(1); // cached

    await app.close();
  });

  it("falls back to cached overture release from db when fetch fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);

    queryMock.mockImplementation((text: string) => {
      if (text.includes("FROM world_meta") && text.includes("overture_release")) {
        return Promise.resolve({ rows: [{ release: "2025-10-01" }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const app = buildServer();
    const response = await app.inject({ method: "GET", url: "/api/overture-latest" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, release: "2025-10-01" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

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

  describe("/api/leaderboard", () => {
    it("returns leaderboard with players ordered by score", async () => {
      queryMock.mockImplementation((text: string) => {
        if (text.includes("FROM players")) {
          return Promise.resolve({
            rows: [
              {
                client_id: "client-abc123",
                display_name: "TopPlayer",
                lifetime_contrib: 5000,
                home_region_id: "region-1",
                last_seen: "2025-01-01T12:00:00Z"
              },
              {
                client_id: "client-def456",
                display_name: null,
                lifetime_contrib: 1000,
                home_region_id: "region-2",
                last_seen: "2025-01-01T11:00:00Z"
              }
            ]
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const response = await app.inject({ method: "GET", url: "/api/leaderboard" });

      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      const payload = response.json();
      expect(payload.ok).toBe(true);
      expect(payload.leaderboard).toHaveLength(2);
      expect(payload.leaderboard[0].rank).toBe(1);
      expect(payload.leaderboard[0].displayName).toBe("TopPlayer");
      expect(payload.leaderboard[0].score).toBe(5000);
      // Privacy: only truncated playerId is exposed (last 8 chars), not full clientId
      expect(payload.leaderboard[0].playerId).toBe("t-abc123");
      expect(payload.leaderboard[0].clientId).toBeUndefined();
      expect(payload.leaderboard[1].rank).toBe(2);
      // Fallback display name uses last 6 chars of client_id
      expect(payload.leaderboard[1].displayName).toBe("Player def456");

      await app.close();
    });

    it("respects limit parameter", async () => {
      queryMock.mockImplementation((text: string, params: unknown[]) => {
        if (text.includes("FROM players")) {
          // Verify limit is passed correctly
          expect(params[0]).toBe(10);
          return Promise.resolve({
            rows: [
              {
                client_id: "client-1",
                display_name: "Player1",
                lifetime_contrib: 100,
                home_region_id: "region-1",
                last_seen: "2025-01-01T12:00:00Z"
              }
            ]
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const response = await app.inject({ method: "GET", url: "/api/leaderboard?limit=10" });

      expect(response.statusCode).toBe(200);
      const payload = response.json();
      expect(payload.ok).toBe(true);

      await app.close();
    });

    it("clamps limit to valid range", async () => {
      queryMock.mockImplementation((text: string, params: unknown[]) => {
        if (text.includes("FROM players")) {
          // Max limit should be clamped to 100
          expect(params[0]).toBe(100);
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const response = await app.inject({ method: "GET", url: "/api/leaderboard?limit=999" });

      expect(response.statusCode).toBe(200);
      const payload = response.json();
      expect(payload.ok).toBe(true);
      expect(payload.leaderboard).toHaveLength(0);

      await app.close();
    });

    it("returns empty leaderboard when no players", async () => {
      queryMock.mockImplementation((text: string) => {
        if (text.includes("FROM players")) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const response = await app.inject({ method: "GET", url: "/api/leaderboard" });

      expect(response.statusCode).toBe(200);
      const payload = response.json();
      expect(payload.ok).toBe(true);
      expect(payload.leaderboard).toHaveLength(0);

      await app.close();
    });
  });
});
