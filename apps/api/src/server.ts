import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import { closePool, getPool } from "./db";

type DbHealth = {
  ok: boolean;
  checked: boolean;
};

function getAppVersion() {
  return process.env.APP_VERSION ?? "dev";
}

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

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: true });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error({ err: error }, "request failed");
    reply.status(500).send({ ok: false, error: "internal_error" });
  });

  app.get("/health", async () => {
    const db = await checkDb();
    return { ok: db.ok, db };
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

  app.post("/api/hello", async (request, reply) => {
    const body = request.body as { client_id?: string; display_name?: string } | undefined;
    const clientId = body?.client_id?.trim();

    if (!clientId) {
      reply.status(400);
      return { ok: false, error: "client_id_required" };
    }

    const pool = getPool();

    await pool.query(
      `
      INSERT INTO players (client_id, display_name, last_seen)
      VALUES ($1, $2, now())
      ON CONFLICT (client_id)
      DO UPDATE SET
        display_name = COALESCE(EXCLUDED.display_name, players.display_name),
        last_seen = now()
      `,
      [clientId, body?.display_name ?? null]
    );

    const playerResult = await pool.query<{ home_region_id: string | null }>(
      "SELECT home_region_id FROM players WHERE client_id = $1",
      [clientId]
    );

    const worldResult = await pool.query<{ version: string | null }>(
      "SELECT value->>'version' as version FROM world_meta WHERE key = 'last_reset'"
    );
    const worldVersion = Number(worldResult.rows[0]?.version ?? 1);

    const regionsResult = await pool.query<{
      region_id: string;
      name: string;
      center: unknown;
    }>(
      "SELECT region_id, name, ST_AsGeoJSON(center)::json as center FROM regions ORDER BY name"
    );

    return {
      ok: true,
      world_version: worldVersion,
      home_region_id: playerResult.rows[0]?.home_region_id ?? null,
      regions: regionsResult.rows,
      cycle: {
        phase: "day",
        phase_progress: 0,
        next_phase_in_seconds: 0
      }
    };
  });

  app.addHook("onClose", async () => {
    await closePool();
  });

  return app;
}
