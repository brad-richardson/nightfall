/**
 * Health check and system status routes
 */

import type { FastifyInstance } from "fastify";
import { getPool } from "../db";
import { getAppVersion } from "../utils/helpers";
import { fetchOvertureLatest } from "../services/overture";

type DbHealth = {
  ok: boolean;
  checked: boolean;
};

async function checkDb(): Promise<DbHealth> {
  if (!process.env.DATABASE_URL) {
    return { ok: true, checked: false };
  }

  try {
    const pool = getPool();
    await pool.query("SELECT 1");
    return { ok: true, checked: true };
  } catch {
    return { ok: false, checked: true };
  }
}

export function registerHealthRoutes(app: FastifyInstance) {
  app.get("/health", async (_request, reply) => {
    const db = await checkDb();
    if (!db.ok) {
      reply.status(503);
    }
    return {
      status: db.ok ? "ok" : "unhealthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      db
    };
  });

  app.get("/health/db", async (_request, reply) => {
    const db = await checkDb();
    if (!db.ok) {
      reply.status(503);
    }
    return { ok: db.ok };
  });

  app.get("/version", async () => {
    return { ok: true, service: "api", version: getAppVersion() };
  });

  app.get("/api/overture-latest", async (_request, reply) => {
    const release = await fetchOvertureLatest();
    if (!release) {
      reply.status(503);
      return { ok: false, error: "overture_unavailable" };
    }

    return { ok: true, release };
  });
}
