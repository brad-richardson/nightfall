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

describe("score tracking", () => {
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

  describe("GET /api/player/score", () => {
    it("returns score data for existing player with scores", async () => {
      const clientId = "test-player-123";

      queryMock.mockImplementation((text: string) => {
        if (text.includes("FROM player_scores") && text.includes("WHERE client_id")) {
          return Promise.resolve({
            rows: [{
              total_score: 150,
              contribution_score: 100,
              vote_score: 35,
              minigame_score: 15,
              task_completion_bonus: 0
            }]
          });
        }
        if (text.includes("COUNT(*)") && text.includes("AS rank")) {
          return Promise.resolve({ rows: [{ rank: 5 }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const response = await app.inject({
        method: "GET",
        url: `/api/player/score?client_id=${clientId}`,
        headers: { authorization: getTestToken(clientId) }
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json();
      expect(payload.ok).toBe(true);
      expect(payload.score.total).toBe(150);
      expect(payload.score.contribution).toBe(100);
      expect(payload.score.vote).toBe(35);
      expect(payload.score.minigame).toBe(15);
      expect(payload.tier.current).toBe("contributor"); // 100-499 is contributor tier
      expect(payload.rank).toBe(5);

      await app.close();
    });

    it("returns zeros for player without score record", async () => {
      const clientId = "new-player-456";

      queryMock.mockImplementation((text: string) => {
        if (text.includes("FROM player_scores")) {
          return Promise.resolve({ rows: [] });
        }
        if (text.includes("FROM players WHERE client_id")) {
          return Promise.resolve({ rows: [{ client_id: clientId }], rowCount: 1 });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const response = await app.inject({
        method: "GET",
        url: `/api/player/score?client_id=${clientId}`,
        headers: { authorization: getTestToken(clientId) }
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json();
      expect(payload.ok).toBe(true);
      expect(payload.score.total).toBe(0);
      expect(payload.tier.current).toBe("newcomer");

      await app.close();
    });

    it("returns 404 for non-existent player", async () => {
      const clientId = "non-existent-789";

      queryMock.mockImplementation((text: string) => {
        if (text.includes("FROM player_scores")) {
          return Promise.resolve({ rows: [] });
        }
        if (text.includes("FROM players WHERE client_id")) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const response = await app.inject({
        method: "GET",
        url: `/api/player/score?client_id=${clientId}`,
        headers: { authorization: getTestToken(clientId) }
      });

      expect(response.statusCode).toBe(404);
      const payload = response.json();
      expect(payload.error).toBe("player_not_found");

      await app.close();
    });

    it("returns 401 for unauthorized request", async () => {
      const app = buildServer();
      const response = await app.inject({
        method: "GET",
        url: "/api/player/score?client_id=test",
        headers: { authorization: "wrong-token" }
      });

      expect(response.statusCode).toBe(401);

      await app.close();
    });
  });

  describe("GET /api/leaderboard", () => {
    it("returns leaderboard with tier info", async () => {
      queryMock.mockImplementation((text: string) => {
        if (text.includes("FROM players p")) {
          return Promise.resolve({
            rows: [
              {
                client_id: "player-aaaaaa11",
                display_name: "Top Player",
                total_score: 15000,
                contribution_score: 10000,
                vote_score: 3000,
                minigame_score: 2000,
                home_region_id: "region-1",
                last_seen: "2025-01-01T00:00:00Z"
              },
              {
                client_id: "player-bbbbbb22",
                display_name: null,
                total_score: 500,
                contribution_score: 400,
                vote_score: 50,
                minigame_score: 50,
                home_region_id: "region-2",
                last_seen: "2025-01-01T00:00:00Z"
              }
            ]
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const response = await app.inject({
        method: "GET",
        url: "/api/leaderboard"
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json();
      expect(payload.ok).toBe(true);
      expect(payload.leaderboard).toHaveLength(2);

      // First player (architect tier: 10,000+)
      expect(payload.leaderboard[0].rank).toBe(1);
      expect(payload.leaderboard[0].score).toBe(15000);
      expect(payload.leaderboard[0].tier).toBe("architect");
      expect(payload.leaderboard[0].tierBadge).toBe("🏗️");
      expect(payload.leaderboard[0].breakdown.contribution).toBe(10000);

      // Second player (builder tier: 500-1999)
      expect(payload.leaderboard[1].rank).toBe(2);
      expect(payload.leaderboard[1].tier).toBe("builder");
      expect(payload.leaderboard[1].displayName).toBe("Player bbbb22");

      await app.close();
    });

    it("filters by region when region_id provided", async () => {
      queryMock.mockImplementation((text: string, params: unknown[]) => {
        if (text.includes("FROM players p") && text.includes("home_region_id = $2")) {
          // Verify region filter is being applied
          expect(params).toContain("region-1");
          return Promise.resolve({
            rows: [{
              client_id: "player-11111111",
              display_name: "Region Player",
              total_score: 100,
              contribution_score: 100,
              vote_score: 0,
              minigame_score: 0,
              home_region_id: "region-1",
              last_seen: "2025-01-01T00:00:00Z"
            }]
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const response = await app.inject({
        method: "GET",
        url: "/api/leaderboard?region_id=region-1"
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json();
      expect(payload.leaderboard).toHaveLength(1);
      expect(payload.leaderboard[0].homeRegionId).toBe("region-1");

      await app.close();
    });
  });

  // Note: Contribute score tracking is tested via the existing endpoints.test.ts tests
  // which verify the full contribute flow including score tracking fields

  // Note: Vote score tests removed - voting functionality has been replaced by
  // automatic distance-based task selection
});
