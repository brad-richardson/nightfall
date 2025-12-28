import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfig } from "../config";

let queryMock = vi.fn();
const closePoolMock = vi.fn();

vi.mock("../db", () => ({
  getPool: () => ({ query: (...args: unknown[]) => queryMock(...args) }),
  closePool: () => closePoolMock()
}));

// Import buildServer after mocking db
import { buildServer } from "../server";

describe("admin endpoints", () => {
  beforeEach(() => {
    queryMock = vi.fn();
    closePoolMock.mockClear();
    resetConfig();
  });

  afterEach(() => {
    delete process.env.ADMIN_SECRET;
    resetConfig();
  });

  describe("when ADMIN_SECRET is not configured", () => {
    beforeEach(() => {
      delete process.env.ADMIN_SECRET;
      resetConfig();
    });

    it("returns 401 for /api/admin/demo-mode", async () => {
      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/admin/demo-mode",
        headers: { authorization: "Bearer some-token" },
        payload: { enabled: true }
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ ok: false, error: "unauthorized" });

      await app.close();
    });

    it("returns 401 for /api/admin/reset", async () => {
      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/admin/reset",
        headers: { authorization: "Bearer some-token" },
        payload: {}
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ ok: false, error: "unauthorized" });

      await app.close();
    });

    it("returns 401 for /api/admin/set-resources", async () => {
      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/admin/set-resources",
        headers: { authorization: "Bearer some-token" },
        payload: { region_id: "region-1", food: 100 }
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ ok: false, error: "unauthorized" });

      await app.close();
    });

    it("returns 401 for /api/admin/set-phase", async () => {
      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/admin/set-phase",
        headers: { authorization: "Bearer some-token" },
        payload: { phase: "night" }
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ ok: false, error: "unauthorized" });

      await app.close();
    });

    it("returns 401 for /api/admin/set-road-health", async () => {
      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/admin/set-road-health",
        headers: { authorization: "Bearer some-token" },
        payload: { region_id: "region-1", health: 50 }
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ ok: false, error: "unauthorized" });

      await app.close();
    });

    it("returns 401 for /api/admin/set-rust", async () => {
      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/admin/set-rust",
        headers: { authorization: "Bearer some-token" },
        payload: { region_id: "region-1", rust_level: 0.5 }
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ ok: false, error: "unauthorized" });

      await app.close();
    });
  });

  describe("when ADMIN_SECRET is configured", () => {
    const validSecret = "test-admin-secret-with-32-characters!";

    beforeEach(() => {
      process.env.ADMIN_SECRET = validSecret;
      resetConfig();
    });

    it("returns 401 with wrong authorization header", async () => {
      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/admin/demo-mode",
        headers: { authorization: "Bearer wrong-secret" },
        payload: { enabled: true }
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ ok: false, error: "unauthorized" });

      await app.close();
    });

    it("returns 401 without authorization header", async () => {
      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/admin/demo-mode",
        payload: { enabled: true }
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ ok: false, error: "unauthorized" });

      await app.close();
    });

    it("accepts valid authorization for /api/admin/demo-mode", async () => {
      queryMock.mockImplementation((text: string) => {
        if (text.includes("INSERT INTO world_meta") || text.includes("UPDATE world_meta")) {
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        if (text.includes("pg_notify")) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/admin/demo-mode",
        headers: { authorization: `Bearer ${validSecret}` },
        payload: { enabled: true }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });

      await app.close();
    });

    it("accepts valid authorization for /api/admin/set-phase", async () => {
      queryMock.mockImplementation((text: string) => {
        if (text.includes("UPDATE cycle_state")) {
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        if (text.includes("pg_notify")) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const app = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/admin/set-phase",
        headers: { authorization: `Bearer ${validSecret}` },
        payload: { phase: "night" }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().ok).toBe(true);

      await app.close();
    });
  });
});
