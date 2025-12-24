import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import { closePool, getPool } from "./db";
import { loadCycleSummary } from "./cycle";
import { createDbPhaseStream } from "./phase-stream";
import type { PhaseStream } from "./phase-stream";

type DbHealth = {
  ok: boolean;
  checked: boolean;
};

type ServerOptions = {
  phaseStream?: PhaseStream;
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

function writeSseEvent(
  stream: NodeJS.WritableStream,
  event: string,
  payload: unknown
) {
  stream.write(`event: ${event}\n`);
  stream.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: true });
  const phaseStream = options.phaseStream ?? createDbPhaseStream(getPool(), app.log);

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

  app.get("/api/stream", async (request, reply) => {
    const once = request.headers["x-sse-once"] === "1";

    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.flushHeaders?.();
    reply.hijack();

    let unsubscribe = () => {};

    try {
      await phaseStream.start?.();
    } catch (error) {
      app.log.error({ err: error }, "phase stream unavailable");
      reply.raw.writeHead(503, { "Content-Type": "application/json" });
      reply.raw.end(JSON.stringify({ ok: false, error: "phase_stream_unavailable" }));
      return;
    }

    unsubscribe = phaseStream.subscribe((payload) => {
      writeSseEvent(reply.raw, "phase_change", payload);

      if (once) {
        unsubscribe();
        reply.raw.end();
      }
    });

    request.raw.on("close", () => {
      unsubscribe();
    });
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

    const cycle = await loadCycleSummary(pool);

    return {
      ok: true,
      world_version: worldVersion,
      home_region_id: playerResult.rows[0]?.home_region_id ?? null,
      regions: regionsResult.rows,
      cycle
    };
  });

  app.addHook("onClose", async () => {
    await closePool();
  });

  return app;
}
