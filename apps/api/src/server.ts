import type { FastifyInstance, FastifyServerOptions } from "fastify";
import Fastify from "fastify";
import { createHmac, timingSafeEqual } from "crypto";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { getConfig } from "./config";
import { closePool, getPool } from "./db";
import { loadCycleState, loadCycleSummary } from "./cycle";
import { createDbEventStream } from "./event-stream";
import type { EventStream } from "./event-stream";
import { ROAD_CLASSES, DEGRADED_HEALTH_THRESHOLD, calculateCityScore } from "@nightfall/config";
import {
  type Graph,
  type ConnectorCoords,
  type Point,
  findPath,
  findNearestConnector,
  buildWaypoints,
} from "@nightfall/pathfinding";

const LAMBDA = 0.1;
const CONTRIBUTION_LIMIT = 2000;
const TAX_MULTIPLIER = 0.8;
const MAX_CLIENT_ID_LENGTH = 64;
const MAX_DISPLAY_NAME_LENGTH = 32;
const MAX_REGION_ID_LENGTH = 64;

const FEATURE_TYPES = new Set(["road", "building", "park", "water", "intersection"]);

// Resource generation categories by building type
const FOOD_CATEGORIES = [
  "restaurant",
  "cafe",
  "bar",
  "food",
  "grocery",
  "supermarket",
  "bakery",
  "deli",
  "farm",
  "farmers_market"
];

const EQUIPMENT_CATEGORIES = [
  "hardware",
  "home_improvement",
  "automotive_repair",
  "auto_body_shop",
  "tool_rental",
  "machine_shop"
];

const ENERGY_CATEGORIES = [
  "industrial",
  "factory",
  "power_plant",
  "solar",
  "wind",
  "utility",
  "electric"
];

const MATERIALS_CATEGORIES = [
  "construction",
  "building_supply",
  "lumber",
  "wood",
  "flooring",
  "warehouse",
  "manufacturing",
  "garden_center",
  "nursery_and_gardening"
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

// Graph cache per hex (simple in-memory cache)
const graphCache = new Map<string, { graph: Graph; coords: ConnectorCoords; timestamp: number }>();
const GRAPH_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Focus hex cache - caches the hex with most degraded roads per region
const focusHexCache = new Map<string, { h3_index: string | null; timestamp: number }>();
const FOCUS_HEX_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

export function resetFocusHexCacheForTests() {
  focusHexCache.clear();
}

async function loadGraphForRegion(
  regionId: string
): Promise<{ graph: Graph; coords: ConnectorCoords } | null> {
  const cacheKey = `region:${regionId}`;

  const cached = graphCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < GRAPH_CACHE_TTL_MS) {
    return { graph: cached.graph, coords: cached.coords };
  }

  const pool = getPool();

  try {
    // Load ALL connectors for the region to ensure complete graph coverage
    const connectorsResult = await pool.query<{
      connector_id: string;
      lng: number;
      lat: number;
    }>(
      `SELECT connector_id, lng, lat FROM road_connectors WHERE region_id = $1`,
      [regionId]
    );

    if (connectorsResult.rows.length === 0) {
      return null;
    }

    const coords: ConnectorCoords = new Map();
    for (const row of connectorsResult.rows) {
      coords.set(row.connector_id, [row.lng, row.lat]);
    }

    // Load ALL edges for the region
    const connectorIds = Array.from(coords.keys());
    const edgesResult = await pool.query<{
      from_connector: string;
      to_connector: string;
      segment_gers_id: string;
      length_meters: number;
      health: number;
    }>(
      `SELECT
        e.from_connector,
        e.to_connector,
        e.segment_gers_id,
        e.length_meters,
        COALESCE(fs.health, 100) as health
      FROM road_edges e
      LEFT JOIN feature_state fs ON fs.gers_id = e.segment_gers_id
      WHERE e.from_connector = ANY($1)`,
      [connectorIds]
    );

    const graph: Graph = new Map();
    for (const row of edgesResult.rows) {
      if (!graph.has(row.from_connector)) {
        graph.set(row.from_connector, []);
      }
      graph.get(row.from_connector)!.push({
        segmentGersId: row.segment_gers_id,
        toConnector: row.to_connector,
        lengthMeters: row.length_meters,
        health: row.health,
      });
    }

    graphCache.set(cacheKey, { graph, coords, timestamp: Date.now() });

    return { graph, coords };
  } catch {
    return null;
  }
}

async function getFocusHex(regionId: string): Promise<string | null> {
  const cached = focusHexCache.get(regionId);
  if (cached && Date.now() - cached.timestamp < FOCUS_HEX_CACHE_TTL_MS) {
    return cached.h3_index;
  }

  const pool = getPool();

  try {
    // Find hex with most degraded roads, fallback to hex with most roads overall
    const result = await pool.query<{ h3_index: string }>(
      `
      WITH road_counts AS (
        SELECT
          wfhc.h3_index,
          COUNT(*) FILTER (WHERE fs.health < ${DEGRADED_HEALTH_THRESHOLD}) AS degraded_count,
          COUNT(*) AS total_count
        FROM world_feature_hex_cells wfhc
        JOIN world_features wf ON wf.gers_id = wfhc.gers_id
        JOIN feature_state fs ON fs.gers_id = wf.gers_id
        WHERE wf.feature_type = 'road' AND wf.region_id = $1
        GROUP BY wfhc.h3_index
      )
      SELECT h3_index FROM road_counts
      ORDER BY degraded_count DESC, total_count DESC
      LIMIT 1
      `,
      [regionId]
    );

    const h3_index = result.rows[0]?.h3_index ?? null;
    focusHexCache.set(regionId, { h3_index, timestamp: Date.now() });
    return h3_index;
  } catch {
    return null;
  }
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

  // Prevent timing attacks with constant-time comparison
  if (actualToken.length !== expected.length) {
    return false;
  }

  try {
    return timingSafeEqual(
      Buffer.from(actualToken, 'utf-8'),
      Buffer.from(expected, 'utf-8')
    );
  } catch {
    return false;
  }
}

function verifyAdminSecret(authHeader: string | undefined, secret: string | undefined): boolean {
  if (!secret || !authHeader) return false;

  const expected = `Bearer ${secret}`;

  // Prevent timing attacks with constant-time comparison
  if (authHeader.length !== expected.length) {
    return false;
  }

  try {
    return timingSafeEqual(
      Buffer.from(authHeader, 'utf-8'),
      Buffer.from(expected, 'utf-8')
    );
  } catch {
    return false;
  }
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

/**
 * Parse ALLOWED_ORIGINS config into an array of origins or true (allow all).
 * Returns true if not specified or empty, otherwise returns filtered array.
 */
function parseAllowedOrigins(allowedOrigins: string | undefined): string[] | true {
  if (!allowedOrigins) {
    return true;
  }
  const origins = allowedOrigins.split(',').map(o => o.trim()).filter(o => o.length > 0);
  return origins.length > 0 ? origins : true;
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: resolveLogger(options.logger) });
  const config = getConfig();
  let sseClients = 0;

  // CORS: Use allowlist in production, allow all in development
  const corsOrigin = parseAllowedOrigins(config.ALLOWED_ORIGINS);
  app.register(cors, {
    origin: corsOrigin,
    credentials: true,
  });
  app.register(helmet, {
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "unsafe-none" },
    contentSecurityPolicy: false, // Disable CSP for API
  });
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

    // Manually set CORS headers for SSE (hijacked responses bypass @fastify/cors)
    const origin = request.headers.origin;
    if (origin) {
      const isAllowed = corsOrigin === true || corsOrigin.includes(origin);
      if (isAllowed) {
        reply.raw.setHeader("Access-Control-Allow-Origin", origin);
        reply.raw.setHeader("Access-Control-Allow-Credentials", "true");
      }
    }

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
      unsubscribe = eventStream.subscribe((payload) => {
        writeSseEvent(reply.raw, payload.event, payload.data);
        if (once) {
          reply.raw.end();
        }
      });
    } catch (error) {
      app.log.error({ err: error }, "event stream unavailable");
      reply.raw.writeHead(503, { "Content-Type": "application/json" });
      reply.raw.end(JSON.stringify({ ok: false, error: "event_stream_unavailable" }));
      cleanup();
      return;
    }
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
      pool_food: number;
      pool_equipment: number;
      pool_energy: number;
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
        r.pool_food::float,
        r.pool_equipment::float,
        r.pool_energy::float,
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

    // Calculate score for each region and city-wide aggregate
    const regionsWithScore = regionResult.rows.map((r) => ({
      ...r,
      score: calculateCityScore(r.health_avg, r.rust_avg)
    }));

    // City-wide score: weighted average by region, or simple average
    const totalHealth = regionResult.rows.reduce((sum, r) => sum + (r.health_avg ?? 0), 0);
    const totalRust = regionResult.rows.reduce((sum, r) => sum + (r.rust_avg ?? 0), 0);
    const regionCount = regionResult.rows.length || 1;
    const cityScore = calculateCityScore(totalHealth / regionCount, totalRust / regionCount);

    return {
      world_version: Number((lastReset as { version?: string | number }).version ?? 1),
      last_reset: (lastReset as { ts?: string }).ts ?? now.toISOString(),
      next_reset: getNextReset(now),
      demo_mode: Boolean((demoMode as { enabled?: boolean }).enabled ?? false),
      city_score: cityScore,
      cycle: {
        phase: cycle.phase,
        phase_progress: cycle.phase_progress,
        phase_start: cycle.phase_start,
        next_phase: cycle.next_phase,
        next_phase_in_seconds: cycle.next_phase_in_seconds
      },
      regions: regionsWithScore
    };
  });

  app.get<{ Params: { region_id: string } }>("/api/region/:region_id", async (request, reply) => {
    const regionId = request.params.region_id;
    const pool = getPool();

    const regionResult = await pool.query<{
      region_id: string;
      name: string;
      boundary: unknown;
      pool_food: number;
      pool_equipment: number;
      pool_energy: number;
      pool_materials: number;
    }>(
      "SELECT region_id, name, ST_AsGeoJSON(boundary)::json as boundary, pool_food::float, pool_equipment::float, pool_energy::float, pool_materials::float FROM regions WHERE region_id = $1",
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
      current_lng: number | null;
      current_lat: number | null;
      waypoints: unknown;
      path_started_at: string | null;
    }>(
      `SELECT crew_id, status, active_task_id, busy_until,
              current_lng, current_lat, waypoints, path_started_at::text
       FROM crews WHERE region_id = $1`,
      [regionId]
    );

    const tasksResult = await pool.query<{
      task_id: string;
      target_gers_id: string;
      priority_score: number;
      status: string;
      vote_score: number;
      cost_food: number;
      cost_equipment: number;
      cost_energy: number;
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
        cost_food,
        cost_equipment,
        cost_energy,
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
        COUNT(*) FILTER (WHERE wf.feature_type = 'road' AND fs.health >= ${DEGRADED_HEALTH_THRESHOLD})::int AS healthy_roads,
        COUNT(*) FILTER (WHERE wf.feature_type = 'road' AND fs.health < ${DEGRADED_HEALTH_THRESHOLD})::int AS degraded_roads,
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

    // Get focus hex (most degraded roads) with caching
    const focusHex = await getFocusHex(regionId);

    // Get in-transit resource transfers for animation
    const transfersResult = await pool.query<{
      transfer_id: string;
      source_gers_id: string | null;
      hub_gers_id: string | null;
      resource_type: string;
      amount: number;
      depart_at: string;
      arrive_at: string;
      path_waypoints: unknown;
    }>(
      `SELECT transfer_id, source_gers_id, hub_gers_id, resource_type,
              amount, depart_at::text, arrive_at::text, path_waypoints
       FROM resource_transfers
       WHERE region_id = $1 AND status = 'in_transit'`,
      [regionId]
    );

    return {
      region_id: region.region_id,
      name: region.name,
      boundary: region.boundary,
      pool_food: region.pool_food,
      pool_equipment: region.pool_equipment,
      pool_energy: region.pool_energy,
      pool_materials: region.pool_materials,
      focus_h3_index: focusHex,
      crews: crewsResult.rows,
      tasks: tasksResult.rows,
      resource_transfers: transfersResult.rows,
      stats: {
        total_roads: Number(statsResult.rows[0]?.total_roads ?? 0),
        healthy_roads: Number(statsResult.rows[0]?.healthy_roads ?? 0),
        degraded_roads: Number(statsResult.rows[0]?.degraded_roads ?? 0),
        rust_avg: Number(rustResult.rows[0]?.rust_avg ?? 0),
        health_avg: Number(statsResult.rows[0]?.health_avg ?? 0)
      }
    };
  });

  // Get all crews with their current positions and animation state
  app.get("/api/crews", async () => {
    const pool = getPool();
    const result = await pool.query<{
      crew_id: string;
      region_id: string;
      status: string;
      active_task_id: string | null;
      current_lng: number | null;
      current_lat: number | null;
      waypoints: unknown;
      path_started_at: string | null;
      target_gers_id: string | null;
    }>(
      `SELECT
        c.crew_id,
        c.region_id,
        c.status,
        c.active_task_id,
        c.current_lng,
        c.current_lat,
        c.waypoints,
        c.path_started_at::text,
        t.target_gers_id
      FROM crews c
      LEFT JOIN tasks t ON t.task_id = c.active_task_id`
    );

    return result.rows.map(row => ({
      crewId: row.crew_id,
      regionId: row.region_id,
      status: row.status,
      taskId: row.active_task_id,
      taskRoadId: row.target_gers_id,
      position: row.current_lng != null && row.current_lat != null
        ? { lng: row.current_lng, lat: row.current_lat }
        : null,
      waypoints: row.waypoints,
      pathStartedAt: row.path_started_at
    }));
  });

  app.get<{ Querystring: { bbox?: string; types?: string } }>("/api/features", async (request, reply) => {
    const bbox = parseBBox(request.query.bbox);
    if (!bbox) {
      reply.status(400);
      return { ok: false, error: "invalid_bbox" };
    }

    const types = parseTypes(request.query.types);
    const pool = getPool();

    const values: Array<number | string[] | string> = [bbox[0], bbox[1], bbox[2], bbox[3]];

    let typesClause = "";
    if (types) {
      values.push(types);
      typesClause = `AND wf.feature_type = ANY($${values.length})`;
    }

    const foodIdx = values.length + 1;
    const equipmentIdx = values.length + 2;
    const energyIdx = values.length + 3;
    const materialsIdx = values.length + 4;

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
      generates_food: boolean;
      generates_equipment: boolean;
      generates_energy: boolean;
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
          wf.generates_food IS TRUE OR
          LOWER(COALESCE(wf.place_category, '')) LIKE ANY($${foodIdx})
        ) AS generates_food,
        (
          wf.generates_equipment IS TRUE OR
          LOWER(COALESCE(wf.place_category, '')) LIKE ANY($${equipmentIdx})
        ) AS generates_equipment,
        (
          wf.generates_energy IS TRUE OR
          LOWER(COALESCE(wf.place_category, '')) LIKE ANY($${energyIdx})
        ) AS generates_energy,
        (
          wf.generates_materials IS TRUE OR
          LOWER(COALESCE(wf.place_category, '')) LIKE ANY($${materialsIdx})
        ) AS generates_materials,
        EXISTS (
          SELECT 1 FROM hex_cells hc WHERE hc.hub_building_gers_id = wf.gers_id
        ) AS is_hub
      FROM world_features AS wf
      LEFT JOIN feature_state AS fs ON fs.gers_id = wf.gers_id
      WHERE wf.bbox_xmin <= $3
        AND wf.bbox_xmax >= $1
        AND wf.bbox_ymin <= $4
        AND wf.bbox_ymax >= $2
      ${typesClause}
      `,
      [
        ...values,
        FOOD_CATEGORIES.map((c) => `%${c}%`),
        EQUIPMENT_CATEGORIES.map((c) => `%${c}%`),
        ENERGY_CATEGORIES.map((c) => `%${c}%`),
        MATERIALS_CATEGORIES.map((c) => `%${c}%`)
      ]
    );

    return { features: featuresResult.rows };
  });

  app.get<{ Querystring: { bbox?: string; region_id?: string } }>("/api/hexes", async (request) => {
    const pool = getPool();

    let whereClause = "";
    const values: (string | number)[] = [];

    if (request.query.region_id) {
      whereClause = "WHERE region_id = $1";
      values.push(request.query.region_id);
    } else if (request.query.bbox) {
      // Fallback: Find regions overlapping the bbox, then get their hexes
      const bbox = parseBBox(request.query.bbox);
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
      food?: number;
      equipment?: number;
      energy?: number;
      materials?: number;
      source_gers_id?: string;
    } | undefined;

    const clientId = body?.client_id?.trim();
    const regionId = body?.region_id?.trim();
    const food = Number(body?.food ?? 0);
    const equipment = Number(body?.equipment ?? 0);
    const energy = Number(body?.energy ?? 0);
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

    if (
      !Number.isFinite(food) || !Number.isFinite(equipment) ||
      !Number.isFinite(energy) || !Number.isFinite(materials) ||
      food < 0 || equipment < 0 || energy < 0 || materials < 0
    ) {
      reply.status(400);
      return { ok: false, error: "invalid_amount" };
    }

    if (food === 0 && equipment === 0 && energy === 0 && materials === 0) {
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
        food_used: number;
        equipment_used: number;
        energy_used: number;
        materials_used: number;
      }>(
        `
        SELECT
          COALESCE(SUM((payload->>'food')::int), 0) AS food_used,
          COALESCE(SUM((payload->>'equipment')::int), 0) AS equipment_used,
          COALESCE(SUM((payload->>'energy')::int), 0) AS energy_used,
          COALESCE(SUM((payload->>'materials')::int), 0) AS materials_used
        FROM events
        WHERE event_type = 'contribute'
          AND client_id = $1
          AND region_id = $2
          AND ts > now() - interval '1 hour'
        `,
        [clientId, regionId]
      );

      const usedFood = Number(usageResult.rows[0]?.food_used ?? 0);
      const usedEquipment = Number(usageResult.rows[0]?.equipment_used ?? 0);
      const usedEnergy = Number(usageResult.rows[0]?.energy_used ?? 0);
      const usedMaterials = Number(usageResult.rows[0]?.materials_used ?? 0);
      const remainingFood = Math.max(0, CONTRIBUTION_LIMIT - usedFood);
      const remainingEquipment = Math.max(0, CONTRIBUTION_LIMIT - usedEquipment);
      const remainingEnergy = Math.max(0, CONTRIBUTION_LIMIT - usedEnergy);
      const remainingMaterials = Math.max(0, CONTRIBUTION_LIMIT - usedMaterials);

      const allowedFood = Math.min(food, remainingFood);
      const allowedEquipment = Math.min(equipment, remainingEquipment);
      const allowedEnergy = Math.min(energy, remainingEnergy);
      const allowedMaterials = Math.min(materials, remainingMaterials);

      if (allowedFood === 0 && allowedEquipment === 0 && allowedEnergy === 0 && allowedMaterials === 0) {
        await pool.query("ROLLBACK");
        reply.status(429);
        return { ok: false, error: "contribution_limit" };
      }

      const taxed = player.home_region_id && player.home_region_id !== regionId;
      const multiplier = taxed ? TAX_MULTIPLIER : 1;

      const appliedFood = Math.floor(allowedFood * multiplier);
      const appliedEquipment = Math.floor(allowedEquipment * multiplier);
      const appliedEnergy = Math.floor(allowedEnergy * multiplier);
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
              wf.gers_id,
              wfh.h3_index,
              wf.bbox_xmin,
              wf.bbox_xmax,
              wf.bbox_ymin,
              wf.bbox_ymax
            FROM world_features wf
            LEFT JOIN world_feature_hex_cells wfh ON wfh.gers_id = wf.gers_id
            WHERE wf.gers_id = $1
              AND wf.region_id = $2
              AND wf.feature_type = 'building'
            LIMIT 1
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
          wfh.h3_index,
          wf.bbox_xmin,
          wf.bbox_xmax,
          wf.bbox_ymin,
          wf.bbox_ymax
        FROM world_features AS wf
        LEFT JOIN world_feature_hex_cells wfh ON wfh.gers_id = wf.gers_id
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

      // Try A* pathfinding with road graph, fallback to haversine
      let travelSeconds: number;
      let pathWaypoints: { coord: Point; arrive_at: string }[] | null = null;
      let pathfindingDebug = "";

      const graphData = await loadGraphForRegion(regionId);
      if (graphData) {
        const { graph, coords } = graphData;
        pathfindingDebug = `region=${regionId}, connectors=${coords.size}, edges=${graph.size}`;

        const startConnector = findNearestConnector(coords, sourceCenter as Point);
        const endConnector = findNearestConnector(coords, hubCenter as Point);

        if (startConnector && endConnector) {
          // Debug: Check if connectors have edges
          const startEdges = graph.get(startConnector)?.length ?? 0;
          const endEdges = graph.get(endConnector)?.length ?? 0;
          pathfindingDebug += `, startEdges=${startEdges}, endEdges=${endEdges}`;

          const pathResult = findPath(graph, coords, startConnector, endConnector);
          if (pathResult) {
            travelSeconds = clamp(
              pathResult.totalWeightedDistance / config.RESOURCE_TRAVEL_MPS,
              config.RESOURCE_TRAVEL_MIN_S,
              config.RESOURCE_TRAVEL_MAX_S
            );

            const departAtMs = Date.now();
            pathWaypoints = buildWaypoints(
              pathResult,
              coords,
              departAtMs,
              config.RESOURCE_TRAVEL_MPS
            );
            pathfindingDebug += `, path=${pathResult.connectorIds.length} waypoints`;
          } else {
            // No path found, fallback to haversine
            pathfindingDebug += `, NO_PATH (start=${startConnector}, end=${endConnector})`;
            const distanceMeters = haversineDistanceMeters(sourceCenter, hubCenter);
            travelSeconds = clamp(
              (distanceMeters * config.RESOURCE_DISTANCE_MULTIPLIER) / config.RESOURCE_TRAVEL_MPS,
              config.RESOURCE_TRAVEL_MIN_S,
              config.RESOURCE_TRAVEL_MAX_S
            );
          }
        } else {
          // No connectors found, fallback to haversine
          pathfindingDebug += `, NO_CONNECTORS (start=${startConnector}, end=${endConnector})`;
          const distanceMeters = haversineDistanceMeters(sourceCenter, hubCenter);
          travelSeconds = clamp(
            (distanceMeters * config.RESOURCE_DISTANCE_MULTIPLIER) / config.RESOURCE_TRAVEL_MPS,
            config.RESOURCE_TRAVEL_MIN_S,
            config.RESOURCE_TRAVEL_MAX_S
          );
        }
      } else {
        // No graph data, fallback to haversine
        pathfindingDebug = `region=${regionId}, NO_GRAPH_DATA`;
        const distanceMeters = haversineDistanceMeters(sourceCenter, hubCenter);
        travelSeconds = clamp(
          (distanceMeters * config.RESOURCE_DISTANCE_MULTIPLIER) / config.RESOURCE_TRAVEL_MPS,
          config.RESOURCE_TRAVEL_MIN_S,
          config.RESOURCE_TRAVEL_MAX_S
        );
      }

      app.log.info({ pathfindingDebug, source: source.gers_id, hub: hub.gers_id }, "pathfinding result");

      const transferRows: Array<{ type: string; amount: number }> = [];
      if (appliedFood > 0) transferRows.push({ type: "food", amount: appliedFood });
      if (appliedEquipment > 0) transferRows.push({ type: "equipment", amount: appliedEquipment });
      if (appliedEnergy > 0) transferRows.push({ type: "energy", amount: appliedEnergy });
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
        resource_type: "food" | "equipment" | "energy" | "materials";
        amount: number;
        depart_at: string;
        arrive_at: string;
        path_waypoints: { coord: Point; arrive_at: string }[] | null;
      }>(
        `
        INSERT INTO resource_transfers (
          region_id,
          source_gers_id,
          hub_gers_id,
          resource_type,
          amount,
          depart_at,
          arrive_at,
          path_waypoints
        )
        SELECT
          $1,
          $2,
          $3,
          resource_type,
          amount,
          now(),
          now() + ($4 || ' seconds')::interval,
          $7::jsonb
        FROM UNNEST($5::text[], $6::int[]) AS t(resource_type, amount)
        RETURNING
          transfer_id,
          region_id,
          source_gers_id,
          hub_gers_id,
          resource_type,
          amount,
          depart_at::text,
          arrive_at::text,
          path_waypoints
        `,
        [
          regionId,
          source.gers_id,
          hub.gers_id,
          travelSeconds,
          types,
          amounts,
          pathWaypoints ? JSON.stringify(pathWaypoints) : null
        ]
      );

      await pool.query(
        "UPDATE players SET lifetime_contrib = lifetime_contrib + $2, last_seen = now() WHERE client_id = $1",
        [clientId, appliedFood + appliedEquipment + appliedEnergy + appliedMaterials]
      );

      await pool.query(
        "INSERT INTO events (event_type, client_id, region_id, payload) VALUES ('contribute', $1, $2, $3::jsonb)",
        [
          clientId,
          regionId,
          JSON.stringify({
            food: allowedFood,
            equipment: allowedEquipment,
            energy: allowedEnergy,
            materials: allowedMaterials,
            applied_food: appliedFood,
            applied_equipment: appliedEquipment,
            applied_energy: appliedEnergy,
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

      // Activate the building so it continues auto-generating resources
      if (sourceGersId) {
        await pool.query(
          `INSERT INTO feature_state (gers_id, last_activated_at)
           VALUES ($1, now())
           ON CONFLICT (gers_id) DO UPDATE SET last_activated_at = now()`,
          [sourceGersId]
        );
      }

      await pool.query("COMMIT");

      return {
        ok: true,
        applied_food: appliedFood,
        applied_equipment: appliedEquipment,
        applied_energy: appliedEnergy,
        applied_materials: appliedMaterials,
        remaining_food: Math.max(0, remainingFood - allowedFood),
        remaining_equipment: Math.max(0, remainingEquipment - allowedEquipment),
        remaining_energy: Math.max(0, remainingEnergy - allowedEnergy),
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
        cost_food: number;
        cost_equipment: number;
        cost_energy: number;
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
            priority_score = (100 - COALESCE(fs.health, 100)) * (
              CASE wf.road_class
                ${weightCases}
                ELSE 1
              END
            ) + $2::float
        FROM world_features AS wf
        LEFT JOIN feature_state AS fs ON fs.gers_id = wf.gers_id
        WHERE t.task_id = $1
          AND wf.gers_id = t.target_gers_id
        RETURNING
          t.task_id,
          t.status,
          t.priority_score,
          t.vote_score,
          t.cost_food,
          t.cost_equipment,
          t.cost_energy,
          t.cost_materials,
          t.duration_s,
          t.repair_amount,
          t.task_type,
          t.target_gers_id,
          t.region_id
        `,
        [taskId, voteScore]
      );

      // Ensure we have task data to send in notification
      let taskDelta = updatedTask.rows[0];
      if (!taskDelta) {
        // Fallback: fetch task details if UPDATE didn't return rows (before COMMIT to stay in transaction)
        const fallbackTask = await pool.query<{
          task_id: string;
          status: string;
          priority_score: number;
          vote_score: number;
          cost_food: number;
          cost_equipment: number;
          cost_energy: number;
          cost_materials: number;
          duration_s: number;
          repair_amount: number;
          task_type: string;
          target_gers_id: string;
          region_id: string;
        }>(
          `SELECT task_id, status, priority_score, vote_score, cost_food, cost_equipment, cost_energy, cost_materials,
                  duration_s, repair_amount, task_type, target_gers_id, region_id
           FROM tasks WHERE task_id = $1`,
          [taskId]
        );
        taskDelta = fallbackTask.rows[0];
      }

      await pool.query("COMMIT");

      // Send notification after successful commit if we have task data
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

  app.get<{ Params: { task_id: string } }>("/api/tasks/:task_id", async (request, reply) => {
    const taskId = request.params.task_id;
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

  // ===== Minigame Endpoints =====

  // Minigame configuration
  const MINIGAME_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
  const BASE_BOOST_DURATION_MS = 3 * 60 * 1000; // 3 minutes base

  // Minigame types by resource
  const FOOD_MINIGAMES = ["kitchen_rush", "fresh_check"];
  const EQUIPMENT_MINIGAMES = ["gear_up", "patch_job"];
  const ENERGY_MINIGAMES = ["power_up"];
  const MATERIALS_MINIGAMES = ["salvage_run"];

  // Max possible scores by minigame type (for anti-cheat)
  const MINIGAME_CONFIG: Record<string, { maxScore: number; expectedDurationMs: number; baseRounds: number }> = {
    kitchen_rush: { maxScore: 1000, expectedDurationMs: 30000, baseRounds: 6 },
    fresh_check: { maxScore: 1000, expectedDurationMs: 25000, baseRounds: 20 },
    gear_up: { maxScore: 1000, expectedDurationMs: 20000, baseRounds: 5 },
    patch_job: { maxScore: 1000, expectedDurationMs: 25000, baseRounds: 3 },
    power_up: { maxScore: 1000, expectedDurationMs: 20000, baseRounds: 1 },
    salvage_run: { maxScore: 1000, expectedDurationMs: 20000, baseRounds: 10 },
  };

  function calculateMinigameReward(score: number, maxScore: number, phase: string) {
    const performance = Math.min(1, score / maxScore);
    const multiplier = 1.5 + (performance * 1.5); // 2.25x at 50%, up to 3x at 100%
    const durationMs = BASE_BOOST_DURATION_MS * (0.33 + performance * 1.67);
    const nightBonus = phase === "night" ? 1.2 : 1.0;

    return {
      multiplier: Math.round(multiplier * 10) / 10,
      durationMs: Math.round(durationMs * nightBonus),
    };
  }

  function getMinigamesForBuilding(building: { generates_food?: boolean; generates_equipment?: boolean; generates_energy?: boolean; generates_materials?: boolean }) {
    if (building.generates_food) return FOOD_MINIGAMES;
    if (building.generates_equipment) return EQUIPMENT_MINIGAMES;
    if (building.generates_energy) return ENERGY_MINIGAMES;
    if (building.generates_materials) return MATERIALS_MINIGAMES;
    return [];
  }

  function getResourceTypeForBuilding(building: { generates_food?: boolean; generates_equipment?: boolean; generates_energy?: boolean; generates_materials?: boolean }) {
    if (building.generates_food) return "food";
    if (building.generates_equipment) return "equipment";
    if (building.generates_energy) return "energy";
    if (building.generates_materials) return "materials";
    return null;
  }

  app.post("/api/minigame/start", async (request, reply) => {
    const body = request.body as {
      client_id?: string;
      building_gers_id?: string;
    } | undefined;

    const clientId = body?.client_id?.trim();
    const buildingGersId = body?.building_gers_id?.trim();
    const authHeader = request.headers["authorization"];

    if (!clientId || !buildingGersId) {
      reply.status(400);
      return { ok: false, error: "client_id_and_building_required" };
    }

    if (!authHeader || !verifyToken(clientId, authHeader)) {
      reply.status(401);
      return { ok: false, error: "unauthorized" };
    }

    const pool = getPool();

    // Check if building exists and is a resource-generating building
    const buildingResult = await pool.query<{
      gers_id: string;
      generates_food: boolean;
      generates_equipment: boolean;
      generates_energy: boolean;
      generates_materials: boolean;
      h3_index: string | null;
    }>(
      `
      SELECT wf.gers_id, wf.generates_food, wf.generates_equipment,
             wf.generates_energy, wf.generates_materials, wfh.h3_index
      FROM world_features wf
      LEFT JOIN world_feature_hex_cells wfh ON wfh.gers_id = wf.gers_id
      WHERE wf.gers_id = $1 AND wf.feature_type = 'building'
      `,
      [buildingGersId]
    );

    const building = buildingResult.rows[0];
    if (!building) {
      reply.status(404);
      return { ok: false, error: "building_not_found" };
    }

    const availableMinigames = getMinigamesForBuilding(building);
    if (availableMinigames.length === 0) {
      reply.status(400);
      return { ok: false, error: "building_not_resource_generating" };
    }

    // Check cooldown
    const cooldownResult = await pool.query<{ available_at: Date }>(
      `SELECT available_at FROM minigame_cooldowns
       WHERE client_id = $1 AND building_gers_id = $2`,
      [clientId, buildingGersId]
    );

    if (cooldownResult.rows.length > 0) {
      const availableAt = new Date(cooldownResult.rows[0].available_at);
      if (availableAt > new Date()) {
        reply.status(429);
        return {
          ok: false,
          error: "cooldown_active",
          available_at: availableAt.toISOString(),
          cooldown_remaining_ms: availableAt.getTime() - Date.now(),
        };
      }
    }

    // Get current cycle phase for difficulty scaling
    const cycleState = await loadCycleState(pool);
    const phase = cycleState.phase;

    // Get rust level at building location
    let rustLevel = 0;
    if (building.h3_index) {
      const rustResult = await pool.query<{ rust_level: number }>(
        "SELECT rust_level FROM hex_cells WHERE h3_index = $1",
        [building.h3_index]
      );
      rustLevel = rustResult.rows[0]?.rust_level ?? 0;
    }

    // Select a random minigame for this resource type
    const selectedMinigame = availableMinigames[Math.floor(Math.random() * availableMinigames.length)];
    const config = MINIGAME_CONFIG[selectedMinigame];

    // Calculate difficulty modifiers
    const isNight = phase === "night";
    const isHighRust = rustLevel > 0.5;
    const speedMult = 1 + (isNight ? 0.25 : 0) + (isHighRust ? 0.1 : 0);
    const windowMult = 1 - (isNight ? 0.2 : 0) - (isHighRust ? 0.1 : 0);
    const extraRounds = isNight ? 2 : 0;

    const difficulty = {
      speed_mult: speedMult,
      window_mult: windowMult,
      extra_rounds: extraRounds,
      rust_level: rustLevel,
      phase,
    };

    // Create minigame session
    const sessionResult = await pool.query<{ session_id: string }>(
      `
      INSERT INTO minigame_sessions (
        client_id, building_gers_id, minigame_type, difficulty,
        max_possible_score, expected_duration_ms
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING session_id
      `,
      [
        clientId,
        buildingGersId,
        selectedMinigame,
        JSON.stringify(difficulty),
        config.maxScore,
        config.expectedDurationMs,
      ]
    );

    const sessionId = sessionResult.rows[0].session_id;

    return {
      ok: true,
      session_id: sessionId,
      minigame_type: selectedMinigame,
      resource_type: getResourceTypeForBuilding(building),
      config: {
        base_rounds: config.baseRounds + extraRounds,
        max_score: config.maxScore,
        expected_duration_ms: config.expectedDurationMs,
      },
      difficulty,
    };
  });

  app.post("/api/minigame/complete", async (request, reply) => {
    const body = request.body as {
      client_id?: string;
      session_id?: string;
      score?: number;
      duration_ms?: number;
    } | undefined;

    const clientId = body?.client_id?.trim();
    const sessionId = body?.session_id?.trim();
    const score = Number(body?.score ?? 0);
    const durationMs = Number(body?.duration_ms ?? 0);
    const authHeader = request.headers["authorization"];

    if (!clientId || !sessionId) {
      reply.status(400);
      return { ok: false, error: "client_id_and_session_required" };
    }

    if (!authHeader || !verifyToken(clientId, authHeader)) {
      reply.status(401);
      return { ok: false, error: "unauthorized" };
    }

    if (!Number.isFinite(score) || score < 0) {
      reply.status(400);
      return { ok: false, error: "invalid_score" };
    }

    const pool = getPool();

    // Verify session exists and belongs to this client
    const sessionResult = await pool.query<{
      session_id: string;
      client_id: string;
      building_gers_id: string;
      minigame_type: string;
      difficulty: { phase: string };
      max_possible_score: number;
      expected_duration_ms: number;
      status: string;
      started_at: Date;
    }>(
      `SELECT * FROM minigame_sessions WHERE session_id = $1`,
      [sessionId]
    );

    const session = sessionResult.rows[0];
    if (!session) {
      reply.status(404);
      return { ok: false, error: "session_not_found" };
    }

    if (session.client_id !== clientId) {
      reply.status(403);
      return { ok: false, error: "session_not_yours" };
    }

    if (session.status !== "active") {
      reply.status(400);
      return { ok: false, error: "session_already_completed" };
    }

    // Anti-cheat: validate score and duration
    if (score > session.max_possible_score) {
      reply.status(400);
      return { ok: false, error: "score_exceeds_maximum" };
    }

    const minDurationMs = session.expected_duration_ms * 0.3; // Allow 30% faster than expected
    if (durationMs < minDurationMs) {
      reply.status(400);
      return { ok: false, error: "duration_too_fast" };
    }

    // Calculate reward
    const reward = calculateMinigameReward(score, session.max_possible_score, session.difficulty.phase);
    const expiresAt = new Date(Date.now() + reward.durationMs);
    const cooldownAt = new Date(Date.now() + MINIGAME_COOLDOWN_MS);

    await pool.query("BEGIN");

    try {
      // Mark session as completed
      await pool.query(
        `UPDATE minigame_sessions SET status = 'completed', completed_at = now() WHERE session_id = $1`,
        [sessionId]
      );

      // Upsert production boost (one active boost per building)
      await pool.query(
        `
        INSERT INTO production_boosts (
          building_gers_id, client_id, multiplier, expires_at, minigame_type, score, session_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (building_gers_id) DO UPDATE SET
          client_id = EXCLUDED.client_id,
          multiplier = EXCLUDED.multiplier,
          started_at = now(),
          expires_at = EXCLUDED.expires_at,
          minigame_type = EXCLUDED.minigame_type,
          score = EXCLUDED.score,
          session_id = EXCLUDED.session_id,
          created_at = now()
        `,
        [session.building_gers_id, clientId, reward.multiplier, expiresAt, session.minigame_type, score, sessionId]
      );

      // Set cooldown
      await pool.query(
        `
        INSERT INTO minigame_cooldowns (client_id, building_gers_id, available_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (client_id, building_gers_id) DO UPDATE SET available_at = EXCLUDED.available_at
        `,
        [clientId, session.building_gers_id, cooldownAt]
      );

      // Emit SSE event for boost via pg_notify
      await pool.query("SELECT pg_notify($1, $2)", [
        "building_boost",
        JSON.stringify({
          building_gers_id: session.building_gers_id,
          multiplier: reward.multiplier,
          expires_at: expiresAt.toISOString(),
          client_id: clientId,
          minigame_type: session.minigame_type,
        })
      ]);

      await pool.query("COMMIT");

      return {
        ok: true,
        reward: {
          multiplier: reward.multiplier,
          duration_ms: reward.durationMs,
          expires_at: expiresAt.toISOString(),
        },
        new_cooldown_at: cooldownAt.toISOString(),
        performance: Math.round((score / session.max_possible_score) * 100),
      };
    } catch (err) {
      await pool.query("ROLLBACK");
      throw err;
    }
  });

  app.post("/api/minigame/abandon", async (request, reply) => {
    const body = request.body as {
      client_id?: string;
      session_id?: string;
    } | undefined;

    const clientId = body?.client_id?.trim();
    const sessionId = body?.session_id?.trim();
    const authHeader = request.headers["authorization"];

    if (!clientId || !sessionId) {
      reply.status(400);
      return { ok: false, error: "client_id_and_session_required" };
    }

    if (!authHeader || !verifyToken(clientId, authHeader)) {
      reply.status(401);
      return { ok: false, error: "unauthorized" };
    }

    const pool = getPool();

    // Verify session exists and belongs to this client
    const sessionResult = await pool.query<{ client_id: string; status: string }>(
      `SELECT client_id, status FROM minigame_sessions WHERE session_id = $1`,
      [sessionId]
    );

    const session = sessionResult.rows[0];
    if (!session) {
      reply.status(404);
      return { ok: false, error: "session_not_found" };
    }

    if (session.client_id !== clientId) {
      reply.status(403);
      return { ok: false, error: "session_not_yours" };
    }

    if (session.status !== "active") {
      reply.status(400);
      return { ok: false, error: "session_already_completed" };
    }

    // Mark session as abandoned (no cooldown penalty)
    await pool.query(
      `UPDATE minigame_sessions SET status = 'abandoned', completed_at = now() WHERE session_id = $1`,
      [sessionId]
    );

    return { ok: true };
  });

  // ===== Admin Endpoints =====

  app.post("/api/admin/demo-mode", {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const authHeader = request.headers["authorization"];

    if (!verifyAdminSecret(authHeader, config.ADMIN_SECRET)) {
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

  app.post("/api/admin/reset", {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const authHeader = request.headers["authorization"];

    if (!verifyAdminSecret(authHeader, config.ADMIN_SECRET)) {
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

  // Set resource pools directly (admin only)
  app.post("/api/admin/set-resources", {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const authHeader = request.headers["authorization"];

    if (!verifyAdminSecret(authHeader, config.ADMIN_SECRET)) {
      reply.status(401);
      return { ok: false, error: "unauthorized" };
    }

    const body = request.body as {
      region_id?: string;
      food?: number;
      equipment?: number;
      energy?: number;
      materials?: number;
    };

    if (!body.region_id) {
      reply.status(400);
      return { ok: false, error: "region_id_required" };
    }

    const pool = getPool();

    const updates: string[] = [];
    const values: (string | number)[] = [body.region_id];
    let paramIndex = 2;

    if (body.food !== undefined && Number.isFinite(body.food) && body.food >= 0) {
      updates.push(`pool_food = $${paramIndex++}`);
      values.push(body.food);
    }
    if (body.equipment !== undefined && Number.isFinite(body.equipment) && body.equipment >= 0) {
      updates.push(`pool_equipment = $${paramIndex++}`);
      values.push(body.equipment);
    }
    if (body.energy !== undefined && Number.isFinite(body.energy) && body.energy >= 0) {
      updates.push(`pool_energy = $${paramIndex++}`);
      values.push(body.energy);
    }
    if (body.materials !== undefined && Number.isFinite(body.materials) && body.materials >= 0) {
      updates.push(`pool_materials = $${paramIndex++}`);
      values.push(body.materials);
    }

    if (updates.length === 0) {
      reply.status(400);
      return { ok: false, error: "no_valid_updates" };
    }

    await pool.query(
      `UPDATE regions SET ${updates.join(", ")} WHERE region_id = $1`,
      values
    );

    // Notify clients of resource change
    const regionResult = await pool.query<{
      pool_food: number;
      pool_equipment: number;
      pool_energy: number;
      pool_materials: number;
    }>(
      "SELECT pool_food::float, pool_equipment::float, pool_energy::float, pool_materials::float FROM regions WHERE region_id = $1",
      [body.region_id]
    );

    if (regionResult.rows[0]) {
      await pool.query("SELECT pg_notify('world_delta', $1)", [
        JSON.stringify({
          type: "region_resources",
          region_id: body.region_id,
          ...regionResult.rows[0]
        })
      ]);
    }

    return { ok: true };
  });

  // Set cycle phase directly (admin only)
  app.post("/api/admin/set-phase", {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const authHeader = request.headers["authorization"];

    if (!verifyAdminSecret(authHeader, config.ADMIN_SECRET)) {
      reply.status(401);
      return { ok: false, error: "unauthorized" };
    }

    const body = request.body as { phase?: string };
    const validPhases = ["dawn", "day", "dusk", "night"];

    if (!body.phase || !validPhases.includes(body.phase)) {
      reply.status(400);
      return { ok: false, error: "invalid_phase" };
    }

    const pool = getPool();

    // Get phase durations from config
    const phaseDurations: Record<string, number> = {
      dawn: 120,   // 2 min transition
      day: 480,    // 8 min
      dusk: 120,   // 2 min transition
      night: 480   // 8 min
    };

    const phaseOrder = ["dawn", "day", "dusk", "night"];
    const currentIndex = phaseOrder.indexOf(body.phase);
    const nextPhase = phaseOrder[(currentIndex + 1) % 4];

    await pool.query(
      `
      INSERT INTO world_meta (key, value, updated_at)
      VALUES ('cycle_state', $1, now())
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = now()
      `,
      [JSON.stringify({
        phase: body.phase,
        phase_start: new Date().toISOString(),
        phase_duration_s: phaseDurations[body.phase]
      })]
    );

    // Notify clients of phase change
    await pool.query("SELECT pg_notify('phase_change', $1)", [
      JSON.stringify({
        phase: body.phase,
        phase_progress: 0,
        next_phase: nextPhase,
        next_phase_in_seconds: phaseDurations[body.phase]
      })
    ]);

    return { ok: true };
  });

  // Set road health for all roads in a region (admin only)
  app.post("/api/admin/set-road-health", {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const authHeader = request.headers["authorization"];

    if (!verifyAdminSecret(authHeader, config.ADMIN_SECRET)) {
      reply.status(401);
      return { ok: false, error: "unauthorized" };
    }

    const body = request.body as { region_id?: string; health?: number };

    if (!body.region_id) {
      reply.status(400);
      return { ok: false, error: "region_id_required" };
    }

    if (body.health === undefined || !Number.isFinite(body.health) || body.health < 0 || body.health > 100) {
      reply.status(400);
      return { ok: false, error: "invalid_health" };
    }

    const pool = getPool();

    await pool.query(
      `
      UPDATE feature_state fs
      SET health = $2
      FROM world_features wf
      WHERE fs.gers_id = wf.gers_id
        AND wf.region_id = $1
        AND wf.feature_type = 'road'
      `,
      [body.region_id, body.health]
    );

    // Notify clients of feature changes
    await pool.query("SELECT pg_notify('world_delta', $1)", [
      JSON.stringify({
        type: "road_health_bulk",
        region_id: body.region_id,
        health: body.health
      })
    ]);

    return { ok: true };
  });

  // Set rust level for all hexes in a region (admin only)
  app.post("/api/admin/set-rust", {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const authHeader = request.headers["authorization"];

    if (!verifyAdminSecret(authHeader, config.ADMIN_SECRET)) {
      reply.status(401);
      return { ok: false, error: "unauthorized" };
    }

    const body = request.body as { region_id?: string; rust_level?: number };

    if (!body.region_id) {
      reply.status(400);
      return { ok: false, error: "region_id_required" };
    }

    if (body.rust_level === undefined || !Number.isFinite(body.rust_level) || body.rust_level < 0 || body.rust_level > 1) {
      reply.status(400);
      return { ok: false, error: "invalid_rust_level" };
    }

    const pool = getPool();

    await pool.query(
      `UPDATE hex_cells SET rust_level = $2 WHERE region_id = $1`,
      [body.region_id, body.rust_level]
    );

    // Notify clients of hex changes
    await pool.query("SELECT pg_notify('world_delta', $1)", [
      JSON.stringify({
        type: "rust_bulk",
        region_id: body.region_id,
        rust_level: body.rust_level
      })
    ]);

    return { ok: true };
  });

  app.addHook("onClose", async () => {
    await closePool();
  });

  return app;
}
