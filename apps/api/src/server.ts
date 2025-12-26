import type { FastifyInstance, FastifyServerOptions } from "fastify";
import Fastify from "fastify";
import { createHmac } from "crypto";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { getConfig } from "./config";
import { closePool, getPool } from "./db";
import { loadCycleState, loadCycleSummary } from "./cycle";
import { createDbEventStream } from "./event-stream";
import type { EventStream } from "./event-stream";
import { ROAD_CLASSES } from "@nightfall/config";

const LAMBDA = 0.1;
const CONTRIBUTION_LIMIT = 1000;
const TAX_MULTIPLIER = 0.8;
const MAX_CLIENT_ID_LENGTH = 64;
const MAX_DISPLAY_NAME_LENGTH = 32;
const MAX_REGION_ID_LENGTH = 64;

const FEATURE_TYPES = new Set(["road", "building", "park", "water", "intersection"]);
const LABOR_CATEGORIES = [
  "restaurant",
  "cafe",
  "bar",
  "food",
  "office",
  "retail",
  "shop",
  "store",
  "school",
  "university",
  "hospital"
];
const MATERIAL_CATEGORIES = [
  "industrial",
  "factory",
  "warehouse",
  "manufacturing",
  "construction",
  "building_supply",
  "hardware",
  "home_improvement",
  "garden_center",
  "nursery_and_gardening",
  "lumber",
  "wood",
  "flooring",
  "automotive_repair",
  "auto_body_shop",
  "industrial_equipment"
];

const OVERTURE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // daily refresh is sufficient; releases are monthly
let overtureLatestCache: { value: string; fetchedAt: number } | null = null;

export function resetOvertureCacheForTests() {
  overtureLatestCache = null;
}

type DbHealth = {
  ok: boolean;
  checked: boolean;
};

type ServerOptions = {
  eventStream?: EventStream;
  logger?: FastifyServerOptions["logger"];
};

function getAppVersion() {
  return process.env.APP_VERSION ?? "dev";
}

function resolveLogger(optionsLogger?: FastifyServerOptions["logger"]) {
  if (optionsLogger !== undefined) {
    return optionsLogger;
  }

  if (process.env.NODE_ENV === "test") {
    return { level: "silent" };
  }

  return true;
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

function writeSseEvent(stream: NodeJS.WritableStream, event: string, payload: unknown) {
  stream.write(`event: ${event}\n`);
  stream.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function parseBBox(value?: string) {
  if (!value) {
    return null;
  }
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return null;
  }
  return parts as [number, number, number, number];
}

function parseTypes(value?: string) {
  if (!value) {
    return null;
  }
  const types = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && FEATURE_TYPES.has(part));

  return types.length > 0 ? types : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function haversineDistanceMeters(a: [number, number], b: [number, number]) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const radLat1 = toRad(lat1);
  const radLat2 = toRad(lat2);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(radLat1) * Math.cos(radLat2) * sinDLng * sinDLng;
  return 6371000 * (2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

function getNextReset(now: Date) {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = next.getUTCDay();
  let daysUntil = (7 - day) % 7;

  if (daysUntil === 0 && now.getUTCHours() + now.getUTCMinutes() + now.getUTCSeconds() > 0) {
    daysUntil = 7;
  }

  next.setUTCDate(next.getUTCDate() + daysUntil);
  next.setUTCHours(0, 0, 0, 0);
  return next.toISOString();
}

function signClientId(clientId: string): string {
  const secret = getConfig().JWT_SECRET;
  const hmac = createHmac("sha256", secret);
  hmac.update(clientId);
  return hmac.digest("hex");
}

function verifyToken(clientId: string, token: string): boolean {
  if (!token) return false;
  // Handle "Bearer <token>" format
  const actualToken = token.startsWith("Bearer ") ? token.slice(7) : token;
  const expected = signClientId(clientId);
  return actualToken === expected;
}

function normalizeOvertureRelease(raw?: string | null): string | null {
  if (!raw) return null;
  const match = raw.match(/(\d{4}-\d{2}-\d{2})(?:\.\d+)?/);
  return match ? match[1] : null;
}

async function readOvertureReleaseFromDb(): Promise<string | null> {
  try {
    const pool = getPool();
    const result = await pool.query<{ release: string | null }>(
      "SELECT value->>'release' AS release FROM world_meta WHERE key = 'overture_release'"
    );
    return result.rows[0]?.release ?? null;
  } catch {
    return null;
  }
}

async function writeOvertureReleaseToDb(release: string): Promise<void> {
  try {
    const pool = getPool();
    await pool.query(
      `
      INSERT INTO world_meta (key, value, updated_at)
      VALUES ('overture_release', jsonb_build_object('release', $1, 'fetched_at', now()), now())
      ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `,
      [release]
    );
  } catch {
    // best-effort cache only
  }
}

async function fetchOvertureLatest(): Promise<string | null> {
  const now = Date.now();
  if (overtureLatestCache && now - overtureLatestCache.fetchedAt < OVERTURE_CACHE_TTL_MS) {
    return overtureLatestCache.value;
  }

  try {
    const response = await fetch("https://stac.overturemaps.org/");
    if (!response.ok) {
      throw new Error(`fetch failed: ${response.status}`);
    }
    const payload = (await response.json()) as {
      latest?: string;
      links?: Array<{ rel?: string; href?: string; latest?: boolean }>;
    };

    const fromLatestField = normalizeOvertureRelease(payload.latest ?? null);
    const fromLinks = normalizeOvertureRelease(
      payload.links?.find((link) => link.latest)?.href ??
        payload.links?.find((link) => link.rel === "child")?.href ??
        null
    );

    const release = fromLatestField ?? fromLinks;
    if (release) {
      overtureLatestCache = { value: release, fetchedAt: now };
      await writeOvertureReleaseToDb(release);
      return release;
    }
  } catch {
    // Swallow and fall back to cache; logger not available here
  }

  const cachedRelease = await readOvertureReleaseFromDb();
  if (cachedRelease) {
    return cachedRelease;
  }

  return overtureLatestCache?.value ?? null;
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: resolveLogger(options.logger) });
  const config = getConfig();
  let sseClients = 0;

  app.register(helmet);
  app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW_MS,
  });

  const eventStream = options.eventStream ?? createDbEventStream(getPool(), app.log);

  app.addHook("onSend", (request, reply, payload, done) => {
    const url = request.raw.url ?? "";
    if (url.startsWith("/api/") && !url.startsWith("/api/stream")) {
      reply.header("Cache-Control", "no-store");
      reply.header("Pragma", "no-cache");
    }
    done(null, payload);
  });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    const message = error instanceof Error ? error.message : String(error);
    reply.status(500).send({ ok: false, error: "internal_error", message });
  });

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

  app.get("/api/stream", async (request, reply) => {
    if (sseClients >= config.SSE_MAX_CLIENTS) {
      reply.status(503).send({ ok: false, error: "too_many_connections" });
      return;
    }

    const once = request.headers["x-sse-once"] === "1";

    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-store");
    reply.raw.setHeader("Pragma", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.flushHeaders?.();
    reply.hijack();

    sseClients++;
    let unsubscribe = () => {};

    const cleanup = () => {
      unsubscribe();
      sseClients--;
    };

    request.raw.on("close", cleanup);

    try {
      await eventStream.start?.();
    } catch (error) {
      app.log.error({ err: error }, "event stream unavailable");
      reply.raw.writeHead(503, { "Content-Type": "application/json" });
      reply.raw.end(JSON.stringify({ ok: false, error: "event_stream_unavailable" }));
      cleanup();
      return;
    }

    unsubscribe = eventStream.subscribe((payload) => {
      writeSseEvent(reply.raw, payload.event, payload.data);

      if (once) {
        // cleanup will be called by 'close' event when we end the response?
        // Or we should call it manually?
        // If we end the response, the socket closes.
        reply.raw.end();
      }
    });
  });

  app.post("/api/hello", async (request, reply) => {
    const body = request.body as { client_id?: string; display_name?: string } | undefined;
    const clientId = body?.client_id?.trim();
    const displayName = body?.display_name?.trim();

    if (!clientId) {
      reply.status(400);
      return { ok: false, error: "client_id_required" };
    }

    if (clientId.length > MAX_CLIENT_ID_LENGTH) {
      reply.status(400);
      return { ok: false, error: "client_id_too_long" };
    }

    if (displayName && displayName.length > MAX_DISPLAY_NAME_LENGTH) {
      reply.status(400);
      return { ok: false, error: "display_name_too_long" };
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
      [clientId, displayName ?? null]
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
      token: signClientId(clientId),
      world_version: worldVersion,
      home_region_id: playerResult.rows[0]?.home_region_id ?? null,
      regions: regionsResult.rows,
      cycle
    };
  });

  app.get("/api/world", async () => {
    const pool = getPool();
    const metaResult = await pool.query<{ key: string; value: { [key: string]: unknown } }>(
      "SELECT key, value FROM world_meta WHERE key IN ('last_reset', 'demo_mode', 'cycle_state')"
    );

    const meta = new Map(metaResult.rows.map((row) => [row.key, row.value]));
    const lastReset = meta.get("last_reset") ?? {};
    const demoMode = meta.get("demo_mode") ?? {};

    const cycle = await loadCycleState(pool);

    const regionResult = await pool.query<{
      region_id: string;
      name: string;
      center: unknown;
      pool_labor: number;
      pool_materials: number;
      crew_count: number;
      active_crews: number;
      rust_avg: number;
      health_avg: number;
    }>(
      `
      SELECT
        r.region_id,
        r.name,
        ST_AsGeoJSON(r.center)::json as center,
        r.pool_labor::float,
        r.pool_materials::float,
        r.crew_count,
        COALESCE(c.active_crews, 0)::int AS active_crews,
        COALESCE(h.rust_avg, 0)::float AS rust_avg,
        COALESCE(s.health_avg, 0)::float AS health_avg
      FROM regions AS r
      LEFT JOIN (
        SELECT region_id, COUNT(*) FILTER (WHERE status != 'idle') AS active_crews
        FROM crews
        GROUP BY region_id
      ) AS c ON c.region_id = r.region_id
      LEFT JOIN (
        SELECT region_id, AVG(rust_level) AS rust_avg
        FROM hex_cells
        GROUP BY region_id
      ) AS h ON h.region_id = r.region_id
      LEFT JOIN (
        SELECT wf.region_id, AVG(fs.health) AS health_avg
        FROM world_features AS wf
        JOIN feature_state AS fs ON fs.gers_id = wf.gers_id
        WHERE wf.feature_type = 'road'
        GROUP BY wf.region_id
      ) AS s ON s.region_id = r.region_id
      ORDER BY r.name
      `
    );

    const now = new Date();

    return {
      world_version: Number((lastReset as { version?: string | number }).version ?? 1),
      last_reset: (lastReset as { ts?: string }).ts ?? now.toISOString(),
      next_reset: getNextReset(now),
      demo_mode: Boolean((demoMode as { enabled?: boolean }).enabled ?? false),
      cycle: {
        phase: cycle.phase,
        phase_progress: cycle.phase_progress,
        phase_start: cycle.phase_start,
        next_phase: cycle.next_phase,
        next_phase_in_seconds: cycle.next_phase_in_seconds
      },
      regions: regionResult.rows
    };
  });

  app.get("/api/region/:region_id", async (request, reply) => {
    const regionId = (request.params as { region_id: string }).region_id;
    const pool = getPool();

    const regionResult = await pool.query<{
      region_id: string;
      name: string;
      boundary: unknown;
      pool_labor: number;
      pool_materials: number;
    }>(
      "SELECT region_id, name, ST_AsGeoJSON(boundary)::json as boundary, pool_labor::float, pool_materials::float FROM regions WHERE region_id = $1",
      [regionId]
    );

    const region = regionResult.rows[0];
    if (!region) {
      reply.status(404);
      return { ok: false, error: "region_not_found" };
    }

    const crewsResult = await pool.query<{
      crew_id: string;
      status: string;
      active_task_id: string | null;
      busy_until: string | null;
    }>(
      "SELECT crew_id, status, active_task_id, busy_until FROM crews WHERE region_id = $1",
      [regionId]
    );

    const tasksResult = await pool.query<{
      task_id: string;
      target_gers_id: string;
      priority_score: number;
      status: string;
      vote_score: number;
      cost_labor: number;
      cost_materials: number;
      duration_s: number;
      repair_amount: number;
      task_type: string;
    }>(
      `
      SELECT
        task_id,
        target_gers_id,
        priority_score::float,
        status,
        vote_score::float,
        cost_labor,
        cost_materials,
        duration_s,
        repair_amount,
        task_type
      FROM tasks
      WHERE region_id = $1
      ORDER BY priority_score DESC
      `,
      [regionId]
    );

    const statsResult = await pool.query<{
      total_roads: number;
      healthy_roads: number;
      degraded_roads: number;
      health_avg: number | null;
    }>(
      `
      SELECT
        COUNT(*) FILTER (WHERE wf.feature_type = 'road')::int AS total_roads,
        COUNT(*) FILTER (WHERE wf.feature_type = 'road' AND fs.health > 80)::int AS healthy_roads,
        COUNT(*) FILTER (WHERE wf.feature_type = 'road' AND fs.health < 30)::int AS degraded_roads,
        AVG(fs.health)::float AS health_avg
      FROM world_features AS wf
      JOIN feature_state AS fs ON fs.gers_id = wf.gers_id
      WHERE wf.region_id = $1
      `,
      [regionId]
    );

    const rustResult = await pool.query<{ rust_avg: number }>(
      "SELECT AVG(rust_level)::float AS rust_avg FROM hex_cells WHERE region_id = $1",
      [regionId]
    );

    return {
      region_id: region.region_id,
      name: region.name,
      boundary: region.boundary,
      pool_labor: region.pool_labor,
      pool_materials: region.pool_materials,
      crews: crewsResult.rows,
      tasks: tasksResult.rows,
      stats: {
        total_roads: Number(statsResult.rows[0]?.total_roads ?? 0),
        healthy_roads: Number(statsResult.rows[0]?.healthy_roads ?? 0),
        degraded_roads: Number(statsResult.rows[0]?.degraded_roads ?? 0),
        rust_avg: Number(rustResult.rows[0]?.rust_avg ?? 0),
        health_avg: Number(statsResult.rows[0]?.health_avg ?? 0)
      }
    };
  });

  app.get("/api/features", async (request, reply) => {
    const query = request.query as { bbox?: string; types?: string };
    const bbox = parseBBox(query.bbox);
    if (!bbox) {
      reply.status(400);
      return { ok: false, error: "invalid_bbox" };
    }

    const types = parseTypes(query.types);
    const pool = getPool();

    const values: Array<number | string[] | string> = [bbox[0], bbox[1], bbox[2], bbox[3]];

    let typesClause = "";
    if (types) {
      values.push(types);
      typesClause = `AND wf.feature_type = ANY($${values.length})`;
    }

    const laborIdx = values.length + 1;
    const materialsIdx = values.length + 2;

    const featuresResult = await pool.query<{
      gers_id: string;
      feature_type: string;
      h3_index: string | null;
      bbox: number[] | null;
      geometry: unknown;
      health: number | null;
      status: string | null;
      road_class: string | null;
      place_category: string | null;
      generates_labor: boolean;
      generates_materials: boolean;
      is_hub: boolean;
    }>(
      `
      SELECT
        wf.gers_id,
        wf.feature_type,
        wf.h3_index,
        json_build_array(wf.bbox_xmin, wf.bbox_ymin, wf.bbox_xmax, wf.bbox_ymax) as bbox,
        ST_AsGeoJSON(wf.geom)::json as geometry,
        fs.health,
        fs.status,
        wf.road_class,
        wf.place_category,
        (
          wf.generates_labor IS TRUE OR
          (
            LOWER(COALESCE(wf.place_category, '')) LIKE ANY($${laborIdx}) AND
            NOT LOWER(COALESCE(wf.place_category, '')) LIKE ANY($${materialsIdx})
          )
        ) AS generates_labor,
        (
          wf.generates_materials IS TRUE OR
          LOWER(COALESCE(wf.place_category, '')) LIKE ANY($${materialsIdx})
        ) AS generates_materials,
        COALESCE(wf.is_hub, FALSE) AS is_hub
      FROM world_features AS wf
      LEFT JOIN feature_state AS fs ON fs.gers_id = wf.gers_id
      WHERE wf.bbox_xmin <= $3
        AND wf.bbox_xmax >= $1
        AND wf.bbox_ymin <= $4
        AND wf.bbox_ymax >= $2
      ${typesClause}
      `,
      [...values, LABOR_CATEGORIES.map((c) => `%${c}%`), MATERIAL_CATEGORIES.map((c) => `%${c}%`)]
    );

    return { features: featuresResult.rows };
  });

  app.get("/api/hexes", async (request) => {
    const query = request.query as { bbox?: string; region_id?: string };
    const pool = getPool();
    
    let whereClause = "";
    const values: (string | number)[] = [];

    if (query.region_id) {
      whereClause = "WHERE region_id = $1";
      values.push(query.region_id);
    } else if (query.bbox) {
      // Fallback: Find regions overlapping the bbox, then get their hexes
      const bbox = parseBBox(query.bbox);
      if (bbox) {
        whereClause = "WHERE region_id IN (SELECT region_id FROM regions WHERE ST_Intersects(boundary, ST_MakeEnvelope($1, $2, $3, $4, 4326)))";
        values.push(...bbox);
      }
    }

    const hexesResult = await pool.query<{
      h3_index: string;
      rust_level: number;
    }>(
      `
      SELECT
        h3_index,
        rust_level::float
      FROM hex_cells
      ${whereClause}
      `,
      values
    );

    return { hexes: hexesResult.rows };
  });

  app.post("/api/set-home", async (request, reply) => {
    const body = request.body as { client_id?: string; region_id?: string } | undefined;
    const clientId = body?.client_id?.trim();
    const regionId = body?.region_id?.trim();
    const authHeader = request.headers["authorization"];

    if (!clientId || !regionId) {
      reply.status(400);
      return { ok: false, error: "client_id_and_region_required" };
    }

    if (!authHeader || !verifyToken(clientId, authHeader)) {
      reply.status(401);
      return { ok: false, error: "unauthorized" };
    }

    if (clientId.length > MAX_CLIENT_ID_LENGTH) {
      reply.status(400);
      return { ok: false, error: "client_id_too_long" };
    }

    if (regionId.length > MAX_REGION_ID_LENGTH) {
      reply.status(400);
      return { ok: false, error: "region_id_too_long" };
    }

    const pool = getPool();
    const updateResult = await pool.query<{ home_region_id: string }>(
      "UPDATE players SET home_region_id = $2 WHERE client_id = $1 AND home_region_id IS NULL RETURNING home_region_id",
      [clientId, regionId]
    );

    if (updateResult.rows[0]) {
      return { ok: true, home_region_id: updateResult.rows[0].home_region_id };
    }

    const existing = await pool.query<{ home_region_id: string | null }>(
      "SELECT home_region_id FROM players WHERE client_id = $1",
      [clientId]
    );

    return {
      ok: false,
      home_region_id: existing.rows[0]?.home_region_id ?? null
    };
  });

  app.post("/api/contribute", async (request, reply) => {
    const body = request.body as {
      client_id?: string;
      region_id?: string;
      labor?: number;
      materials?: number;
      source_gers_id?: string;
    } | undefined;

    const clientId = body?.client_id?.trim();
    const regionId = body?.region_id?.trim();
    const labor = Number(body?.labor ?? 0);
    const materials = Number(body?.materials ?? 0);
    const sourceGersId = body?.source_gers_id?.trim();
    const authHeader = request.headers["authorization"];

    if (!clientId || !regionId) {
      reply.status(400);
      return { ok: false, error: "client_id_and_region_required" };
    }

    if (!authHeader || !verifyToken(clientId, authHeader)) {
      reply.status(401);
      return { ok: false, error: "unauthorized" };
    }

    if (clientId.length > MAX_CLIENT_ID_LENGTH) {
      reply.status(400);
      return { ok: false, error: "client_id_too_long" };
    }

    if (regionId.length > MAX_REGION_ID_LENGTH) {
      reply.status(400);
      return { ok: false, error: "region_id_too_long" };
    }

    if (!Number.isFinite(labor) || !Number.isFinite(materials) || labor < 0 || materials < 0) {
      reply.status(400);
      return { ok: false, error: "invalid_amount" };
    }

    if (labor === 0 && materials === 0) {
      reply.status(400);
      return { ok: false, error: "empty_contribution" };
    }

    const pool = getPool();

    await pool.query("BEGIN");

    try {
      const playerResult = await pool.query<{ home_region_id: string | null }>(
        "SELECT home_region_id FROM players WHERE client_id = $1 FOR UPDATE",
        [clientId]
      );

      const player = playerResult.rows[0];
      if (!player) {
        await pool.query("ROLLBACK");
        reply.status(404);
        return { ok: false, error: "player_not_found" };
      }

      const usageResult = await pool.query<{
        labor_used: number;
        materials_used: number;
      }>(
        `
        SELECT
          COALESCE(SUM((payload->>'labor')::int), 0) AS labor_used,
          COALESCE(SUM((payload->>'materials')::int), 0) AS materials_used
        FROM events
        WHERE event_type = 'contribute'
          AND client_id = $1
          AND region_id = $2
          AND ts > now() - interval '1 hour'
        `,
        [clientId, regionId]
      );

      const usedLabor = Number(usageResult.rows[0]?.labor_used ?? 0);
      const usedMaterials = Number(usageResult.rows[0]?.materials_used ?? 0);
      const remainingLabor = Math.max(0, CONTRIBUTION_LIMIT - usedLabor);
      const remainingMaterials = Math.max(0, CONTRIBUTION_LIMIT - usedMaterials);

      const allowedLabor = Math.min(labor, remainingLabor);
      const allowedMaterials = Math.min(materials, remainingMaterials);

      if (allowedLabor === 0 && allowedMaterials === 0) {
        await pool.query("ROLLBACK");
        reply.status(429);
        return { ok: false, error: "contribution_limit" };
      }

      const taxed = player.home_region_id && player.home_region_id !== regionId;
      const multiplier = taxed ? TAX_MULTIPLIER : 1;

      const appliedLabor = Math.floor(allowedLabor * multiplier);
      const appliedMaterials = Math.floor(allowedMaterials * multiplier);

      const sourceResult = sourceGersId
        ? await pool.query<{
            gers_id: string;
            h3_index: string | null;
            bbox_xmin: number | null;
            bbox_xmax: number | null;
            bbox_ymin: number | null;
            bbox_ymax: number | null;
          }>(
            `
            SELECT
              gers_id,
              h3_index,
              bbox_xmin,
              bbox_xmax,
              bbox_ymin,
              bbox_ymax
            FROM world_features
            WHERE gers_id = $1
              AND region_id = $2
              AND feature_type = 'building'
            `,
            [sourceGersId, regionId]
          )
        : null;

      if (sourceGersId && sourceResult?.rows.length === 0) {
        await pool.query("ROLLBACK");
        reply.status(400);
        return { ok: false, error: "invalid_source_gers_id" };
      }

      const fallbackSource = await pool.query<{
        gers_id: string;
        h3_index: string | null;
        bbox_xmin: number | null;
        bbox_xmax: number | null;
        bbox_ymin: number | null;
        bbox_ymax: number | null;
      }>(
        `
        SELECT
          wf.gers_id,
          wf.h3_index,
          wf.bbox_xmin,
          wf.bbox_xmax,
          wf.bbox_ymin,
          wf.bbox_ymax
        FROM world_features AS wf
        WHERE wf.region_id = $1
          AND wf.is_hub IS TRUE
        ORDER BY wf.created_at ASC
        LIMIT 1
        `,
        [regionId]
      );

      const source = sourceResult?.rows[0] ?? fallbackSource.rows[0];
      if (
        !source ||
        source.bbox_xmin === null ||
        source.bbox_xmax === null ||
        source.bbox_ymin === null ||
        source.bbox_ymax === null
      ) {
        await pool.query("ROLLBACK");
        reply.status(404);
        return { ok: false, error: "source_not_found" };
      }

      const sourceCenter: [number, number] = [
        (source.bbox_xmin + source.bbox_xmax) / 2,
        (source.bbox_ymin + source.bbox_ymax) / 2
      ];

      const hubResult = source.h3_index
        ? await pool.query<{
            gers_id: string;
            bbox_xmin: number | null;
            bbox_xmax: number | null;
            bbox_ymin: number | null;
            bbox_ymax: number | null;
          }>(
            `
            SELECT
              hub.gers_id,
              hub.bbox_xmin,
              hub.bbox_xmax,
              hub.bbox_ymin,
              hub.bbox_ymax
            FROM hex_cells AS h
            JOIN world_features AS hub ON hub.gers_id = h.hub_building_gers_id
            WHERE h.h3_index = $1
            `,
            [source.h3_index]
          )
        : null;

      const hub = hubResult?.rows[0] ?? fallbackSource.rows[0];
      if (
        !hub ||
        hub.bbox_xmin === null ||
        hub.bbox_xmax === null ||
        hub.bbox_ymin === null ||
        hub.bbox_ymax === null
      ) {
        await pool.query("ROLLBACK");
        reply.status(404);
        return { ok: false, error: "hub_not_found" };
      }

      const hubCenter: [number, number] = [
        (hub.bbox_xmin + hub.bbox_xmax) / 2,
        (hub.bbox_ymin + hub.bbox_ymax) / 2
      ];

      const distanceMeters = haversineDistanceMeters(sourceCenter, hubCenter);
      const travelSeconds = clamp(
        (distanceMeters * config.RESOURCE_DISTANCE_MULTIPLIER) / config.RESOURCE_TRAVEL_MPS,
        config.RESOURCE_TRAVEL_MIN_S,
        config.RESOURCE_TRAVEL_MAX_S
      );

      const transferRows: Array<{ type: string; amount: number }> = [];
      if (appliedLabor > 0) transferRows.push({ type: "labor", amount: appliedLabor });
      if (appliedMaterials > 0) transferRows.push({ type: "materials", amount: appliedMaterials });

      if (transferRows.length === 0) {
        await pool.query("ROLLBACK");
        reply.status(400);
        return { ok: false, error: "empty_contribution" };
      }

      const types = transferRows.map((row) => row.type);
      const amounts = transferRows.map((row) => row.amount);

      const transferResult = await pool.query<{
        transfer_id: string;
        region_id: string;
        source_gers_id: string | null;
        hub_gers_id: string | null;
        resource_type: "labor" | "materials";
        amount: number;
        depart_at: string;
        arrive_at: string;
      }>(
        `
        INSERT INTO resource_transfers (
          region_id,
          source_gers_id,
          hub_gers_id,
          resource_type,
          amount,
          depart_at,
          arrive_at
        )
        SELECT
          $1,
          $2,
          $3,
          resource_type,
          amount,
          now(),
          now() + ($4 || ' seconds')::interval
        FROM UNNEST($5::text[], $6::int[]) AS t(resource_type, amount)
        RETURNING
          transfer_id,
          region_id,
          source_gers_id,
          hub_gers_id,
          resource_type,
          amount,
          depart_at::text,
          arrive_at::text
        `,
        [
          regionId,
          source.gers_id,
          hub.gers_id,
          travelSeconds,
          types,
          amounts
        ]
      );

      await pool.query(
        "UPDATE players SET lifetime_contrib = lifetime_contrib + $2, last_seen = now() WHERE client_id = $1",
        [clientId, appliedLabor + appliedMaterials]
      );

      await pool.query(
        "INSERT INTO events (event_type, client_id, region_id, payload) VALUES ('contribute', $1, $2, $3::jsonb)",
        [
          clientId,
          regionId,
          JSON.stringify({
            labor: allowedLabor,
            materials: allowedMaterials,
            applied_labor: appliedLabor,
            applied_materials: appliedMaterials,
            taxed,
            source_gers_id: source.gers_id,
            hub_gers_id: hub.gers_id
          })
        ]
      );

      for (const transfer of transferResult.rows) {
        await pool.query("SELECT pg_notify($1, $2)", [
          "resource_transfer",
          JSON.stringify(transfer)
        ]);
      }

      await pool.query("COMMIT");

      return {
        ok: true,
        applied_labor: appliedLabor,
        applied_materials: appliedMaterials,
        remaining_labor: Math.max(0, remainingLabor - allowedLabor),
        remaining_materials: Math.max(0, remainingMaterials - allowedMaterials),
        transfers: transferResult.rows
      };
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  });

  app.post("/api/vote", async (request, reply) => {
    const body = request.body as { client_id?: string; task_id?: string; weight?: number } | undefined;
    const clientId = body?.client_id?.trim();
    const taskId = body?.task_id?.trim();
    const weight = Number(body?.weight ?? 0);
    const authHeader = request.headers["authorization"];

    if (!clientId || !taskId || ![1, -1].includes(weight)) {
      reply.status(400);
      return { ok: false, error: "invalid_vote" };
    }

    if (!authHeader || !verifyToken(clientId, authHeader)) {
      reply.status(401);
      return { ok: false, error: "unauthorized" };
    }

    if (clientId.length > MAX_CLIENT_ID_LENGTH) {
      reply.status(400);
      return { ok: false, error: "client_id_too_long" };
    }

    const pool = getPool();

    await pool.query("BEGIN");

    try {
      const weightCases = Object.entries(ROAD_CLASSES)
        .map(([cls, info]) => `WHEN '${cls}' THEN ${info.priorityWeight}`)
        .join("\n          ");

      const taskResult = await pool.query("SELECT 1 FROM tasks WHERE task_id = $1 FOR UPDATE", [
        taskId
      ]);

      if (taskResult.rowCount === 0) {
        await pool.query("ROLLBACK");
        reply.status(404);
        return { ok: false, error: "task_not_found" };
      }

      await pool.query(
        `
        INSERT INTO task_votes (task_id, client_id, weight, created_at)
        VALUES ($1, $2, $3, now())
        ON CONFLICT (task_id, client_id)
        DO UPDATE SET weight = EXCLUDED.weight, created_at = now()
        `,
        [taskId, clientId, weight]
      );

      const scoreResult = await pool.query<{ vote_score: number }>(
        `
        SELECT
          COALESCE(SUM(weight * EXP(-$2::float * EXTRACT(EPOCH FROM (now() - created_at::timestamptz)) / 3600.0)), 0) AS vote_score
        FROM task_votes
        WHERE task_id = $1
        `,
        [taskId, LAMBDA]
      );

      const voteScore = Number(scoreResult.rows[0]?.vote_score ?? 0);

      const updatedTask = await pool.query<{
        task_id: string;
        status: string;
        priority_score: number;
        vote_score: number;
        cost_labor: number;
        cost_materials: number;
        duration_s: number;
        repair_amount: number;
        task_type: string;
        target_gers_id: string;
        region_id: string;
      }>(
        `
        UPDATE tasks AS t
        SET vote_score = $2::float,
            priority_score = (100 - fs.health) * (
              CASE wf.road_class
                ${weightCases}
                ELSE 1
              END
            ) + $2::float
        FROM world_features AS wf
        JOIN feature_state AS fs ON fs.gers_id = wf.gers_id
        WHERE t.task_id = $1
          AND wf.gers_id = t.target_gers_id
        RETURNING
          t.task_id,
          t.status,
          t.priority_score,
          t.vote_score,
          t.cost_labor,
          t.cost_materials,
          t.duration_s,
          t.repair_amount,
          t.task_type,
          t.target_gers_id,
          t.region_id
        `,
        [taskId, voteScore]
      );

      await pool.query("COMMIT");

      const taskDelta = updatedTask.rows[0];
      if (taskDelta) {
        await pool.query("SELECT pg_notify('task_delta', $1)", [
          JSON.stringify(taskDelta)
        ]);
      }

      return { ok: true, new_vote_score: voteScore, priority_score: taskDelta?.priority_score ?? null };
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  });

  app.get("/api/tasks/:task_id", async (request, reply) => {
    const taskId = (request.params as { task_id: string }).task_id;
    const pool = getPool();

    const taskResult = await pool.query<{
      task_id: string;
      target_gers_id: string;
      task_type: string;
      priority_score: number;
      vote_score: number;
      status: string;
      duration_s: number;
      created_at: string;
      road_class: string | null;
      health: number;
    }>(
      `
      SELECT
        t.task_id,
        t.target_gers_id,
        t.task_type,
        t.priority_score,
        t.vote_score,
        t.status,
        t.duration_s,
        t.created_at,
        wf.road_class,
        fs.health
      FROM tasks AS t
      JOIN world_features AS wf ON wf.gers_id = t.target_gers_id
      JOIN feature_state AS fs ON fs.gers_id = t.target_gers_id
      WHERE t.task_id = $1
      `,
      [taskId]
    );

    const task = taskResult.rows[0];
    if (!task) {
      reply.status(404);
      return { ok: false, error: "task_not_found" };
    }

    const voteScoreResult = await pool.query<{ vote_score: number }>(
      `
      SELECT
        COALESCE(SUM(weight * EXP(-$2::float * EXTRACT(EPOCH FROM (now() - created_at::timestamptz)) / 3600.0)), 0) AS vote_score
      FROM task_votes
      WHERE task_id = $1
      `,
      [taskId, LAMBDA]
    );

    const crewResult = await pool.query<{ busy_until: string | null }>(
      "SELECT busy_until FROM crews WHERE active_task_id = $1",
      [taskId]
    );

    const busyUntil = crewResult.rows[0]?.busy_until;
    const etaSeconds = busyUntil
      ? Math.max(0, Math.ceil((new Date(busyUntil).getTime() - Date.now()) / 1000))
      : null;

    return {
      task_id: task.task_id,
      target_gers_id: task.target_gers_id,
      task_type: task.task_type,
      road_class: task.road_class,
      health: task.health,
      priority_score: task.priority_score,
      votes: voteScoreResult.rows[0]?.vote_score ?? 0,
      status: task.status,
      eta: etaSeconds ?? task.duration_s
    };
  });

  // Admin Endpoints

  app.post("/api/admin/demo-mode", async (request, reply) => {
    const authHeader = request.headers["authorization"];
    const secret = config.ADMIN_SECRET;

    if (!secret || authHeader !== `Bearer ${secret}`) {
      reply.status(401);
      return { ok: false, error: "unauthorized" };
    }

    const body = request.body as {
      enabled: boolean;
      tick_multiplier?: number;
      cycle_speed?: number;
    };

    const pool = getPool();
    await pool.query(
      `
      INSERT INTO world_meta (key, value, updated_at)
      VALUES ('demo_mode', $1, now())
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = now()
      `,
      [JSON.stringify({
        enabled: body.enabled,
        tick_multiplier: body.tick_multiplier ?? 1,
        cycle_speed: body.cycle_speed ?? 1
      })]
    );

    return { ok: true };
  });

  app.post("/api/admin/reset", async (request, reply) => {
    const authHeader = request.headers["authorization"];
    const secret = config.ADMIN_SECRET;

    if (!secret || authHeader !== `Bearer ${secret}`) {
      reply.status(401);
      return { ok: false, error: "unauthorized" };
    }

    const pool = getPool();
    // Signal a pending reset to the ticker via world_meta
    await pool.query(
      `
      INSERT INTO world_meta (key, value, updated_at)
      VALUES ('pending_reset', 'true'::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = now()
      `
    );

    return { ok: true, message: "reset_scheduled" };
  });

  app.addHook("onClose", async () => {
    await closePool();
  });

  return app;
}
