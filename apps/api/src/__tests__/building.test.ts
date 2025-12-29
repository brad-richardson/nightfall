import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";
import { buildServer } from "../server";

let queryMock = vi.fn();
const closePoolMock = vi.fn();

vi.mock("../db", () => ({
  getPool: () => ({ query: (...args: unknown[]) => queryMock(...args) }),
  closePool: () => closePoolMock()
}));

// Mock the graph service to avoid actual DB calls
vi.mock("../services/graph", () => ({
  loadGraphForRegion: vi.fn().mockResolvedValue(null)
}));

function getTestToken(clientId: string) {
  const hmac = createHmac("sha256", "dev-secret-do-not-use-in-prod");
  hmac.update(clientId);
  return hmac.digest("hex");
}

describe("building routes", () => {
  beforeEach(() => {
    queryMock = vi.fn();
    closePoolMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("POST /api/building/activate", () => {
    it("requires client_id and building_gers_id", async () => {
      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/building/activate",
        payload: {}
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ ok: false, error: "client_id_and_building_required" });

      await app.close();
    });

    it("requires valid authorization", async () => {
      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/building/activate",
        payload: { client_id: "player1", building_gers_id: "bld-123" },
        headers: { authorization: "Bearer invalid-token" }
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ ok: false, error: "unauthorized" });

      await app.close();
    });

    it("returns 404 if building not found", async () => {
      queryMock.mockImplementation((text: string) => {
        if (text.includes("SELECT wf.gers_id")) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const token = getTestToken("player1");
      const response = await app.inject({
        method: "POST",
        url: "/api/building/activate",
        payload: { client_id: "player1", building_gers_id: "bld-123" },
        headers: { authorization: `Bearer ${token}` }
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ ok: false, error: "building_not_found" });

      await app.close();
    });

    it("rejects non-resource-generating buildings", async () => {
      queryMock.mockImplementation((text: string) => {
        if (text.includes("SELECT wf.gers_id")) {
          return Promise.resolve({
            rows: [{
              gers_id: "bld-123",
              generates_food: false,
              generates_equipment: false,
              generates_energy: false,
              generates_materials: false
            }]
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const token = getTestToken("player1");
      const response = await app.inject({
        method: "POST",
        url: "/api/building/activate",
        payload: { client_id: "player1", building_gers_id: "bld-123" },
        headers: { authorization: `Bearer ${token}` }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ ok: false, error: "building_not_resource_generating" });

      await app.close();
    });

    it("returns already_activated if building was recently activated", async () => {
      const now = new Date();
      const lastActivatedAt = new Date(now.getTime() - 60000); // 1 minute ago

      queryMock.mockImplementation((text: string) => {
        if (text.includes("SELECT wf.gers_id")) {
          return Promise.resolve({
            rows: [{
              gers_id: "bld-123",
              generates_food: true,
              generates_equipment: false,
              generates_energy: false,
              generates_materials: false
            }]
          });
        }
        if (text.includes("SELECT last_activated_at")) {
          return Promise.resolve({
            rows: [{ last_activated_at: lastActivatedAt }]
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const token = getTestToken("player1");
      const response = await app.inject({
        method: "POST",
        url: "/api/building/activate",
        payload: { client_id: "player1", building_gers_id: "bld-123" },
        headers: { authorization: `Bearer ${token}` }
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.ok).toBe(true);
      expect(json.already_activated).toBe(true);

      await app.close();
    });

    it("activates building and creates immediate transfer", async () => {
      queryMock.mockImplementation((text: string, params?: unknown[]) => {
        // Building lookup
        if (text.includes("SELECT wf.gers_id")) {
          return Promise.resolve({
            rows: [{
              gers_id: "bld-123",
              generates_food: true,
              generates_equipment: false,
              generates_energy: false,
              generates_materials: false
            }]
          });
        }
        // Check for existing activation
        if (text.includes("SELECT last_activated_at FROM feature_state")) {
          return Promise.resolve({ rows: [] });
        }
        // Upsert activation
        if (text.includes("INSERT INTO feature_state")) {
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        // pg_notify for building_activation
        if (text.includes("pg_notify") && (params as string[])?.[0] === "building_activation") {
          return Promise.resolve({ rows: [] });
        }
        // Check for existing in_transit transfer
        if (text.includes("SELECT transfer_id FROM resource_transfers")) {
          return Promise.resolve({ rows: [] });
        }
        // Building data query (for transfer creation)
        if (text.includes("WITH building_hex AS")) {
          return Promise.resolve({
            rows: [{
              region_id: "region-1",
              source_lon: -68.25,
              source_lat: 44.39,
              rust_level: 0.1,
              boost_multiplier: null,
              hub_gers_id: "hub-1",
              hub_lon: -68.24,
              hub_lat: 44.38
            }]
          });
        }
        // Cycle state
        if (text.includes("cycle_state")) {
          return Promise.resolve({
            rows: [{
              cycle_start: "2025-01-01T00:00:00Z",
              phase_start: "2025-01-01T00:00:00Z"
            }]
          });
        }
        // Insert resource transfer
        if (text.includes("INSERT INTO resource_transfers")) {
          return Promise.resolve({
            rows: [{
              transfer_id: "transfer-1",
              region_id: "region-1",
              source_gers_id: "bld-123",
              hub_gers_id: "hub-1",
              resource_type: "food",
              amount: 12,
              depart_at: "2025-01-01T00:00:00Z",
              arrive_at: "2025-01-01T00:00:10Z",
              path_waypoints: null
            }]
          });
        }
        // pg_notify for resource_transfer
        if (text.includes("pg_notify") && (params as string[])?.[0] === "resource_transfer") {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const token = getTestToken("player1");
      const response = await app.inject({
        method: "POST",
        url: "/api/building/activate",
        payload: { client_id: "player1", building_gers_id: "bld-123" },
        headers: { authorization: `Bearer ${token}` }
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.ok).toBe(true);
      expect(json.already_activated).toBe(false);
      expect(json.activated_at).toBeDefined();
      expect(json.expires_at).toBeDefined();
      expect(json.transfer).toBeDefined();
      expect(json.transfer.transfer_id).toBe("transfer-1");
      expect(json.transfer.resource_type).toBe("food");

      await app.close();
    });

    it("returns null transfer when no hub is found", async () => {
      queryMock.mockImplementation((text: string, params?: unknown[]) => {
        // Building lookup
        if (text.includes("SELECT wf.gers_id")) {
          return Promise.resolve({
            rows: [{
              gers_id: "bld-123",
              generates_food: true,
              generates_equipment: false,
              generates_energy: false,
              generates_materials: false
            }]
          });
        }
        // Check for existing activation
        if (text.includes("SELECT last_activated_at FROM feature_state")) {
          return Promise.resolve({ rows: [] });
        }
        // Upsert activation
        if (text.includes("INSERT INTO feature_state")) {
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        // pg_notify for building_activation
        if (text.includes("pg_notify") && (params as string[])?.[0] === "building_activation") {
          return Promise.resolve({ rows: [] });
        }
        // Check for existing in_transit transfer
        if (text.includes("SELECT transfer_id FROM resource_transfers")) {
          return Promise.resolve({ rows: [] });
        }
        // Building data query returns no hub
        if (text.includes("WITH building_hex AS")) {
          return Promise.resolve({
            rows: [{
              region_id: "region-1",
              source_lon: -68.25,
              source_lat: 44.39,
              rust_level: 0.1,
              boost_multiplier: null,
              hub_gers_id: null,
              hub_lon: null,
              hub_lat: null
            }]
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const token = getTestToken("player1");
      const response = await app.inject({
        method: "POST",
        url: "/api/building/activate",
        payload: { client_id: "player1", building_gers_id: "bld-123" },
        headers: { authorization: `Bearer ${token}` }
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.ok).toBe(true);
      expect(json.transfer).toBeNull();

      await app.close();
    });

    it("returns null transfer when building already has in_transit convoy", async () => {
      queryMock.mockImplementation((text: string, params?: unknown[]) => {
        // Building lookup
        if (text.includes("SELECT wf.gers_id")) {
          return Promise.resolve({
            rows: [{
              gers_id: "bld-123",
              generates_food: true,
              generates_equipment: false,
              generates_energy: false,
              generates_materials: false
            }]
          });
        }
        // Check for existing activation
        if (text.includes("SELECT last_activated_at FROM feature_state")) {
          return Promise.resolve({ rows: [] });
        }
        // Upsert activation
        if (text.includes("INSERT INTO feature_state")) {
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        // pg_notify for building_activation
        if (text.includes("pg_notify") && (params as string[])?.[0] === "building_activation") {
          return Promise.resolve({ rows: [] });
        }
        // Existing in_transit transfer found
        if (text.includes("SELECT transfer_id FROM resource_transfers")) {
          return Promise.resolve({
            rows: [{ transfer_id: "existing-transfer" }]
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const token = getTestToken("player1");
      const response = await app.inject({
        method: "POST",
        url: "/api/building/activate",
        payload: { client_id: "player1", building_gers_id: "bld-123" },
        headers: { authorization: `Bearer ${token}` }
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.ok).toBe(true);
      // Transfer is null because one already exists
      expect(json.transfer).toBeNull();

      await app.close();
    });

    it("returns null transfer when rust level produces zero resources", async () => {
      queryMock.mockImplementation((text: string, params?: unknown[]) => {
        // Building lookup
        if (text.includes("SELECT wf.gers_id")) {
          return Promise.resolve({
            rows: [{
              gers_id: "bld-123",
              generates_food: true,
              generates_equipment: false,
              generates_energy: false,
              generates_materials: false
            }]
          });
        }
        // Check for existing activation
        if (text.includes("SELECT last_activated_at FROM feature_state")) {
          return Promise.resolve({ rows: [] });
        }
        // Upsert activation
        if (text.includes("INSERT INTO feature_state")) {
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        // pg_notify for building_activation
        if (text.includes("pg_notify") && (params as string[])?.[0] === "building_activation") {
          return Promise.resolve({ rows: [] });
        }
        // Check for existing in_transit transfer
        if (text.includes("SELECT transfer_id FROM resource_transfers")) {
          return Promise.resolve({ rows: [] });
        }
        // Building data with 100% rust (produces zero resources)
        if (text.includes("WITH building_hex AS")) {
          return Promise.resolve({
            rows: [{
              region_id: "region-1",
              source_lon: -68.25,
              source_lat: 44.39,
              rust_level: 1.0,  // 100% rust
              boost_multiplier: null,
              hub_gers_id: "hub-1",
              hub_lon: -68.24,
              hub_lat: 44.38
            }]
          });
        }
        // Cycle state
        if (text.includes("cycle_state")) {
          return Promise.resolve({
            rows: [{
              cycle_start: "2025-01-01T00:00:00Z",
              phase_start: "2025-01-01T00:00:00Z"
            }]
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const token = getTestToken("player1");
      const response = await app.inject({
        method: "POST",
        url: "/api/building/activate",
        payload: { client_id: "player1", building_gers_id: "bld-123" },
        headers: { authorization: `Bearer ${token}` }
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.ok).toBe(true);
      // Transfer is null because rust_level = 1.0 means 0 resources
      expect(json.transfer).toBeNull();

      await app.close();
    });
  });
});
