import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";
import { buildServer } from "../server";

let queryMock = vi.fn();

vi.mock("../db", () => ({
  getPool: () => ({ query: (...args: unknown[]) => queryMock(...args) }),
  closePool: () => vi.fn()
}));

function getTestToken(clientId: string) {
  const hmac = createHmac("sha256", "dev-secret-do-not-use-in-prod");
  hmac.update(clientId);
  return hmac.digest("hex");
}

describe("repair minigame API routes", () => {
  beforeEach(() => {
    queryMock = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("POST /api/repair-minigame/start", () => {
    it("requires client_id and road_gers_id", async () => {
      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/repair-minigame/start",
        headers: { authorization: `Bearer ${getTestToken("client-1")}` },
        payload: { client_id: "client-1" }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("client_id_and_road_required");

      await app.close();
    });

    it("rejects unauthorized requests", async () => {
      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/repair-minigame/start",
        headers: { authorization: "Bearer invalid-token" },
        payload: { client_id: "client-1", road_gers_id: "road-1" }
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error).toBe("unauthorized");

      await app.close();
    });

    it("returns 404 for non-existent road", async () => {
      queryMock.mockImplementation((text: string) => {
        if (text.includes("FROM world_features wf")) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/repair-minigame/start",
        headers: { authorization: `Bearer ${getTestToken("client-1")}` },
        payload: { client_id: "client-1", road_gers_id: "nonexistent-road" }
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toBe("road_not_found");

      await app.close();
    });

    it("rejects repair for healthy roads (100% health)", async () => {
      queryMock.mockImplementation((text: string) => {
        if (text.includes("FROM world_features wf")) {
          return Promise.resolve({
            rows: [{ gers_id: "road-1", road_class: "primary", h3_index: "hex-1" }]
          });
        }
        if (text.includes("FROM feature_state")) {
          return Promise.resolve({ rows: [{ health: 100 }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/repair-minigame/start",
        headers: { authorization: `Bearer ${getTestToken("client-1")}` },
        payload: { client_id: "client-1", road_gers_id: "road-1" }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("road_already_healthy");

      await app.close();
    });

    it("rejects when repair already in progress", async () => {
      queryMock.mockImplementation((text: string) => {
        if (text.includes("FROM world_features wf")) {
          return Promise.resolve({
            rows: [{ gers_id: "road-1", road_class: "primary", h3_index: "hex-1" }]
          });
        }
        if (text.includes("FROM feature_state")) {
          return Promise.resolve({ rows: [{ health: 50 }] });
        }
        if (text.includes("FROM repair_minigame_sessions")) {
          return Promise.resolve({ rows: [{ session_id: "existing-session" }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/repair-minigame/start",
        headers: { authorization: `Bearer ${getTestToken("client-1")}` },
        payload: { client_id: "client-1", road_gers_id: "road-1" }
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error).toBe("repair_already_in_progress");

      await app.close();
    });

    it("creates a repair minigame session successfully", async () => {
      queryMock.mockImplementation((text: string) => {
        if (text.includes("FROM world_features wf")) {
          return Promise.resolve({
            rows: [{ gers_id: "road-1", road_class: "secondary", h3_index: "hex-1" }]
          });
        }
        if (text.includes("FROM feature_state")) {
          return Promise.resolve({ rows: [{ health: 40 }] });
        }
        if (text.includes("FROM repair_minigame_sessions")) {
          return Promise.resolve({ rows: [] });
        }
        if (text.includes("FROM cycle_state")) {
          return Promise.resolve({
            rows: [{ cycle_start: new Date().toISOString(), phase_start: new Date().toISOString() }]
          });
        }
        if (text.includes("FROM hex_cells")) {
          return Promise.resolve({ rows: [{ rust_level: 0.3 }] });
        }
        if (text.includes("INSERT INTO repair_minigame_sessions")) {
          return Promise.resolve({ rows: [{ session_id: "new-session-123" }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/repair-minigame/start",
        headers: { authorization: `Bearer ${getTestToken("client-1")}` },
        payload: { client_id: "client-1", road_gers_id: "road-1" }
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json();
      expect(payload.ok).toBe(true);
      expect(payload.session_id).toBe("new-session-123");
      expect(payload.road_class).toBe("secondary");
      expect(payload.current_health).toBe(40);
      expect(payload.target_health).toBe(100);
      expect(payload.minigame_type).toMatch(/^(pothole_patrol|road_roller|traffic_director)$/);
      expect(payload.config).toBeDefined();
      expect(payload.difficulty).toBeDefined();

      await app.close();
    });

    it("adds extra rounds based on damage level", async () => {
      // 40 health = 60 damage = 2 extra rounds
      queryMock.mockImplementation((text: string) => {
        if (text.includes("FROM world_features wf")) {
          return Promise.resolve({
            rows: [{ gers_id: "road-1", road_class: "primary", h3_index: "hex-1" }]
          });
        }
        if (text.includes("FROM feature_state")) {
          return Promise.resolve({ rows: [{ health: 40 }] });
        }
        if (text.includes("FROM repair_minigame_sessions")) {
          return Promise.resolve({ rows: [] });
        }
        if (text.includes("FROM cycle_state")) {
          return Promise.resolve({
            rows: [{ cycle_start: new Date().toISOString(), phase_start: new Date().toISOString() }]
          });
        }
        if (text.includes("FROM hex_cells")) {
          return Promise.resolve({ rows: [{ rust_level: 0.3 }] });
        }
        if (text.includes("INSERT INTO repair_minigame_sessions")) {
          return Promise.resolve({ rows: [{ session_id: "new-session" }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/repair-minigame/start",
        headers: { authorization: `Bearer ${getTestToken("client-1")}` },
        payload: { client_id: "client-1", road_gers_id: "road-1" }
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json();
      // Damage of 60 (40 health) should add 2 extra rounds
      expect(payload.difficulty.extra_rounds).toBe(2);

      await app.close();
    });
  });

  describe("POST /api/repair-minigame/complete", () => {
    it("requires client_id and session_id", async () => {
      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/repair-minigame/complete",
        headers: { authorization: `Bearer ${getTestToken("client-1")}` },
        payload: { client_id: "client-1" }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("client_id_and_session_required");

      await app.close();
    });

    it("rejects unauthorized requests", async () => {
      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/repair-minigame/complete",
        headers: { authorization: "Bearer invalid-token" },
        payload: { client_id: "client-1", session_id: "session-1", score: 500 }
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error).toBe("unauthorized");

      await app.close();
    });

    it("rejects invalid score values", async () => {
      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/repair-minigame/complete",
        headers: { authorization: `Bearer ${getTestToken("client-1")}` },
        payload: { client_id: "client-1", session_id: "session-1", score: -100 }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("invalid_score");

      await app.close();
    });

    it("returns 404 for non-existent session", async () => {
      queryMock.mockImplementation((text: string) => {
        if (text.includes("FROM repair_minigame_sessions")) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/repair-minigame/complete",
        headers: { authorization: `Bearer ${getTestToken("client-1")}` },
        payload: { client_id: "client-1", session_id: "nonexistent", score: 500, duration_ms: 20000 }
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toBe("session_not_found");

      await app.close();
    });

    it("rejects completion of another player's session", async () => {
      queryMock.mockImplementation((text: string) => {
        if (text.includes("FROM repair_minigame_sessions")) {
          return Promise.resolve({
            rows: [{
              session_id: "session-1",
              client_id: "other-client",
              road_gers_id: "road-1",
              minigame_type: "pothole_patrol",
              difficulty: { phase: "day" },
              max_possible_score: 1000,
              expected_duration_ms: 20000,
              status: "active",
              current_health: 50,
              started_at: new Date()
            }]
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/repair-minigame/complete",
        headers: { authorization: `Bearer ${getTestToken("client-1")}` },
        payload: { client_id: "client-1", session_id: "session-1", score: 500, duration_ms: 20000 }
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error).toBe("session_not_yours");

      await app.close();
    });

    it("rejects completion of already completed session", async () => {
      queryMock.mockImplementation((text: string) => {
        if (text.includes("FROM repair_minigame_sessions")) {
          return Promise.resolve({
            rows: [{
              session_id: "session-1",
              client_id: "client-1",
              road_gers_id: "road-1",
              minigame_type: "pothole_patrol",
              difficulty: { phase: "day" },
              max_possible_score: 1000,
              expected_duration_ms: 20000,
              status: "completed",
              current_health: 50,
              started_at: new Date()
            }]
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/repair-minigame/complete",
        headers: { authorization: `Bearer ${getTestToken("client-1")}` },
        payload: { client_id: "client-1", session_id: "session-1", score: 500, duration_ms: 20000 }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("session_already_completed");

      await app.close();
    });

    it("clamps excessive scores and returns warning", async () => {
      queryMock.mockImplementation((text: string) => {
        if (text.includes("FROM repair_minigame_sessions")) {
          return Promise.resolve({
            rows: [{
              session_id: "session-1",
              client_id: "client-1",
              road_gers_id: "road-1",
              minigame_type: "pothole_patrol",
              difficulty: { phase: "day" },
              max_possible_score: 1000,
              expected_duration_ms: 20000,
              status: "active",
              current_health: 50,
              started_at: new Date()
            }]
          });
        }
        if (text.includes("UPDATE repair_minigame_sessions")) {
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        if (text.includes("INSERT INTO feature_state")) {
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        if (text.includes("UPDATE tasks")) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        if (text.includes("pg_notify")) {
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        if (text.includes("FROM world_features")) {
          return Promise.resolve({ rows: [{ region_id: "region-1" }] });
        }
        if (text.includes("INSERT INTO player_scores")) {
          return Promise.resolve({ rows: [{ total_score: 100 }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/repair-minigame/complete",
        headers: { authorization: `Bearer ${getTestToken("client-1")}` },
        payload: { client_id: "client-1", session_id: "session-1", score: 9999, duration_ms: 20000 }
      });

      // Score is clamped to 2x max (2000) instead of rejected
      expect(response.statusCode).toBe(200);
      expect(response.json().ok).toBe(true);
      expect(response.json().warning).toBe("score_clamped");

      await app.close();
    });

    it("rejects suspiciously fast completion", async () => {
      queryMock.mockImplementation((text: string) => {
        if (text.includes("FROM repair_minigame_sessions")) {
          return Promise.resolve({
            rows: [{
              session_id: "session-1",
              client_id: "client-1",
              road_gers_id: "road-1",
              minigame_type: "pothole_patrol",
              difficulty: { phase: "day" },
              max_possible_score: 1000,
              expected_duration_ms: 20000,
              status: "active",
              current_health: 50,
              started_at: new Date()
            }]
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/repair-minigame/complete",
        headers: { authorization: `Bearer ${getTestToken("client-1")}` },
        payload: { client_id: "client-1", session_id: "session-1", score: 500, duration_ms: 1000 }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("duration_too_fast");

      await app.close();
    });

    it("completes repair successfully with high score", async () => {
      queryMock.mockImplementation((text: string) => {
        if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") {
          return Promise.resolve({ rows: [] });
        }
        if (text.includes("FROM repair_minigame_sessions") && text.includes("SELECT *")) {
          return Promise.resolve({
            rows: [{
              session_id: "session-1",
              client_id: "client-1",
              road_gers_id: "road-1",
              minigame_type: "pothole_patrol",
              difficulty: { phase: "day" },
              max_possible_score: 1000,
              expected_duration_ms: 20000,
              status: "active",
              current_health: 50,
              started_at: new Date()
            }]
          });
        }
        if (text.includes("UPDATE repair_minigame_sessions")) {
          return Promise.resolve({ rows: [] });
        }
        if (text.includes("INSERT INTO feature_state")) {
          return Promise.resolve({ rows: [] });
        }
        if (text.includes("pg_notify")) {
          return Promise.resolve({ rows: [] });
        }
        if (text.includes("FROM world_features WHERE")) {
          return Promise.resolve({ rows: [{ region_id: "region-1" }] });
        }
        if (text.includes("INSERT INTO player_scores")) {
          return Promise.resolve({ rows: [{ total_score: 100 }] });
        }
        if (text.includes("INSERT INTO score_events")) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/repair-minigame/complete",
        headers: { authorization: `Bearer ${getTestToken("client-1")}` },
        payload: { client_id: "client-1", session_id: "session-1", score: 800, duration_ms: 25000 }
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json();
      expect(payload.ok).toBe(true);
      expect(payload.success).toBe(true);
      expect(payload.performance).toBe(80); // 800/1000 = 80%
      expect(payload.new_health).toBeGreaterThan(50);
      expect(payload.health_restored).toBeGreaterThan(0);

      await app.close();
    });

    it("fails repair with low score but still restores minimal health", async () => {
      queryMock.mockImplementation((text: string) => {
        if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") {
          return Promise.resolve({ rows: [] });
        }
        if (text.includes("FROM repair_minigame_sessions") && text.includes("SELECT *")) {
          return Promise.resolve({
            rows: [{
              session_id: "session-1",
              client_id: "client-1",
              road_gers_id: "road-1",
              minigame_type: "pothole_patrol",
              difficulty: { phase: "day" },
              max_possible_score: 1000,
              expected_duration_ms: 20000,
              status: "active",
              current_health: 50,
              started_at: new Date()
            }]
          });
        }
        if (text.includes("UPDATE repair_minigame_sessions")) {
          return Promise.resolve({ rows: [] });
        }
        if (text.includes("INSERT INTO feature_state")) {
          return Promise.resolve({ rows: [] });
        }
        if (text.includes("pg_notify")) {
          return Promise.resolve({ rows: [] });
        }
        if (text.includes("FROM world_features WHERE")) {
          return Promise.resolve({ rows: [{ region_id: "region-1" }] });
        }
        if (text.includes("INSERT INTO player_scores")) {
          return Promise.resolve({ rows: [{ total_score: 50 }] });
        }
        if (text.includes("INSERT INTO score_events")) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/repair-minigame/complete",
        headers: { authorization: `Bearer ${getTestToken("client-1")}` },
        payload: { client_id: "client-1", session_id: "session-1", score: 200, duration_ms: 25000 }
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json();
      expect(payload.ok).toBe(true);
      expect(payload.success).toBe(false); // 200/1000 = 20% < 60% threshold
      expect(payload.performance).toBe(20);
      // Failed repair still restores 10% of damage (50 damage * 0.1 = 5)
      expect(payload.health_restored).toBe(5);
      expect(payload.new_health).toBe(55);

      await app.close();
    });
  });

  describe("POST /api/repair-minigame/abandon", () => {
    it("requires client_id and session_id", async () => {
      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/repair-minigame/abandon",
        headers: { authorization: `Bearer ${getTestToken("client-1")}` },
        payload: { client_id: "client-1" }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("client_id_and_session_required");

      await app.close();
    });

    it("rejects unauthorized requests", async () => {
      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/repair-minigame/abandon",
        headers: { authorization: "Bearer invalid-token" },
        payload: { client_id: "client-1", session_id: "session-1" }
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error).toBe("unauthorized");

      await app.close();
    });

    it("returns 404 for non-existent session", async () => {
      queryMock.mockImplementation((text: string) => {
        if (text.includes("FROM repair_minigame_sessions")) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/repair-minigame/abandon",
        headers: { authorization: `Bearer ${getTestToken("client-1")}` },
        payload: { client_id: "client-1", session_id: "nonexistent" }
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toBe("session_not_found");

      await app.close();
    });

    it("rejects abandoning another player's session", async () => {
      queryMock.mockImplementation((text: string) => {
        if (text.includes("FROM repair_minigame_sessions")) {
          return Promise.resolve({
            rows: [{ client_id: "other-client", status: "active" }]
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/repair-minigame/abandon",
        headers: { authorization: `Bearer ${getTestToken("client-1")}` },
        payload: { client_id: "client-1", session_id: "session-1" }
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error).toBe("session_not_yours");

      await app.close();
    });

    it("rejects abandoning already completed session", async () => {
      queryMock.mockImplementation((text: string) => {
        if (text.includes("FROM repair_minigame_sessions")) {
          return Promise.resolve({
            rows: [{ client_id: "client-1", status: "completed" }]
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/repair-minigame/abandon",
        headers: { authorization: `Bearer ${getTestToken("client-1")}` },
        payload: { client_id: "client-1", session_id: "session-1" }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("session_already_completed");

      await app.close();
    });

    it("abandons session successfully", async () => {
      queryMock.mockImplementation((text: string) => {
        if (text.includes("SELECT client_id, status FROM repair_minigame_sessions")) {
          return Promise.resolve({
            rows: [{ client_id: "client-1", status: "active" }]
          });
        }
        if (text.includes("UPDATE repair_minigame_sessions SET status = 'abandoned'")) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/repair-minigame/abandon",
        headers: { authorization: `Bearer ${getTestToken("client-1")}` },
        payload: { client_id: "client-1", session_id: "session-1" }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });

      await app.close();
    });
  });

  describe("health restoration calculation", () => {
    it("restores 80% of damage at 60% performance (success threshold)", async () => {
      // 60% performance → restorePercent = 0.5 + (0.6 * 0.5) = 0.8 = 80%
      // 50 damage * 0.8 = 40 restored
      queryMock.mockImplementation((text: string) => {
        if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") {
          return Promise.resolve({ rows: [] });
        }
        if (text.includes("FROM repair_minigame_sessions") && text.includes("SELECT *")) {
          return Promise.resolve({
            rows: [{
              session_id: "session-1",
              client_id: "client-1",
              road_gers_id: "road-1",
              minigame_type: "pothole_patrol",
              difficulty: { phase: "day" },
              max_possible_score: 1000,
              expected_duration_ms: 20000,
              status: "active",
              current_health: 50, // 50 damage
              started_at: new Date()
            }]
          });
        }
        if (text.includes("UPDATE repair_minigame_sessions") ||
            text.includes("INSERT INTO feature_state") ||
            text.includes("pg_notify") ||
            text.includes("INSERT INTO player_scores") ||
            text.includes("INSERT INTO score_events")) {
          return Promise.resolve({ rows: [{ total_score: 100 }] });
        }
        if (text.includes("FROM world_features WHERE")) {
          return Promise.resolve({ rows: [{ region_id: "region-1" }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/repair-minigame/complete",
        headers: { authorization: `Bearer ${getTestToken("client-1")}` },
        payload: { client_id: "client-1", session_id: "session-1", score: 600, duration_ms: 25000 }
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json();
      expect(payload.success).toBe(true);
      expect(payload.performance).toBe(60);
      expect(payload.health_restored).toBe(40); // 50 damage * 0.8 = 40
      expect(payload.new_health).toBe(90); // 50 + 40 = 90

      await app.close();
    });

    it("restores 100% of damage at 100% performance", async () => {
      // 100% performance → restorePercent = 0.5 + (1.0 * 0.5) = 1.0 = 100%
      // 50 damage * 1.0 = 50 restored
      queryMock.mockImplementation((text: string) => {
        if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") {
          return Promise.resolve({ rows: [] });
        }
        if (text.includes("FROM repair_minigame_sessions") && text.includes("SELECT *")) {
          return Promise.resolve({
            rows: [{
              session_id: "session-1",
              client_id: "client-1",
              road_gers_id: "road-1",
              minigame_type: "pothole_patrol",
              difficulty: { phase: "day" },
              max_possible_score: 1000,
              expected_duration_ms: 20000,
              status: "active",
              current_health: 50,
              started_at: new Date()
            }]
          });
        }
        if (text.includes("UPDATE repair_minigame_sessions") ||
            text.includes("INSERT INTO feature_state") ||
            text.includes("pg_notify") ||
            text.includes("INSERT INTO player_scores") ||
            text.includes("INSERT INTO score_events")) {
          return Promise.resolve({ rows: [{ total_score: 100 }] });
        }
        if (text.includes("FROM world_features WHERE")) {
          return Promise.resolve({ rows: [{ region_id: "region-1" }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/repair-minigame/complete",
        headers: { authorization: `Bearer ${getTestToken("client-1")}` },
        payload: { client_id: "client-1", session_id: "session-1", score: 1000, duration_ms: 25000 }
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json();
      expect(payload.success).toBe(true);
      expect(payload.performance).toBe(100);
      expect(payload.health_restored).toBe(50);
      expect(payload.new_health).toBe(100);

      await app.close();
    });
  });
});
