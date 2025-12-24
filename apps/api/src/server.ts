import type { FastifyInstance, FastifyRequest } from "fastify";
import Fastify from "fastify";
import { closePool, getPool } from "./db";
import { calculatePhase } from "./utils/phase";

// Error codes for client handling
export const ErrorCode = {
  INTERNAL_ERROR: "internal_error",
  MISSING_FIELD: "missing_field",
  INVALID_FIELD: "invalid_field",
  DB_ERROR: "db_error",
  NOT_FOUND: "not_found"
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

type ErrorResponse = {
  ok: false;
  error: ErrorCode;
  message: string;
  field?: string;
  request_id?: string;
};

type DbHealth = {
  ok: boolean;
  checked: boolean;
};

function createErrorResponse(
  code: ErrorCode,
  message: string,
  request?: FastifyRequest,
  field?: string
): ErrorResponse {
  return {
    ok: false,
    error: code,
    message,
    ...(field && { field }),
    ...(request && { request_id: request.id })
  };
}

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

  app.setErrorHandler((error, request, reply) => {
    app.log.error({ err: error, requestId: request.id }, "request failed");

    // Check for database errors
    const isDbError =
      error.message?.includes("ECONNREFUSED") ||
      error.message?.includes("connection") ||
      error.message?.includes("timeout");

    const code = isDbError ? ErrorCode.DB_ERROR : ErrorCode.INTERNAL_ERROR;
    const message = isDbError
      ? "Database connection error"
      : "An unexpected error occurred";

    reply.status(500).send(createErrorResponse(code, message, request));
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
      return createErrorResponse(
        ErrorCode.MISSING_FIELD,
        "client_id is required",
        request,
        "client_id"
      );
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

    // Get cycle state from world_meta
    const cycleResult = await pool.query<{ cycle_start: Date | null }>(
      "SELECT (value->>'cycle_start')::timestamptz as cycle_start FROM world_meta WHERE key = 'cycle_state'"
    );
    const cycleStartedAt = cycleResult.rows[0]?.cycle_start ?? new Date();
    const cycleState = calculatePhase(cycleStartedAt);

    return {
      ok: true,
      world_version: worldVersion,
      home_region_id: playerResult.rows[0]?.home_region_id ?? null,
      regions: regionsResult.rows,
      cycle: {
        phase: cycleState.phase,
        phase_progress: cycleState.phase_progress,
        next_phase_in_seconds: cycleState.next_phase_in_seconds
      }
    };
  });

  app.addHook("onClose", async () => {
    await closePool();
  });

  return app;
}
