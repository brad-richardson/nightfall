import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import { closePool, getPool } from "./db";
import { loadCycleState, loadCycleSummary } from "./cycle";
import { createDbEventStream } from "./event-stream";
import type { EventStream } from "./event-stream";

const LAMBDA = 0.1;
const CONTRIBUTION_LIMIT = 100;
const TAX_MULTIPLIER = 0.8;

const FEATURE_TYPES = new Set(["road", "building", "park", "water", "intersection"]);

type DbHealth = {
  ok: boolean;
  checked: boolean;
};

type ServerOptions = {
  eventStream?: EventStream;
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

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: true });
  const eventStream = options.eventStream ?? createDbEventStream(getPool(), app.log);

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
      await eventStream.start?.();
    } catch (error) {
      app.log.error({ err: error }, "event stream unavailable");
      reply.raw.writeHead(503, { "Content-Type": "application/json" });
      reply.raw.end(JSON.stringify({ ok: false, error: "event_stream_unavailable" }));
      return;
    }

    unsubscribe = eventStream.subscribe((payload) => {
      writeSseEvent(reply.raw, payload.event, payload.data);

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
        r.pool_labor,
        r.pool_materials,
        r.crew_count,
        COALESCE(c.active_crews, 0) AS active_crews,
        COALESCE(h.rust_avg, 0) AS rust_avg,
        COALESCE(s.health_avg, 0) AS health_avg
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
      "SELECT region_id, name, ST_AsGeoJSON(boundary)::json as boundary, pool_labor, pool_materials FROM regions WHERE region_id = $1",
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
        priority_score,
        status,
        vote_score,
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
    }>(
      `
      SELECT
        COUNT(*) FILTER (WHERE wf.feature_type = 'road') AS total_roads,
        COUNT(*) FILTER (WHERE wf.feature_type = 'road' AND fs.health > 80) AS healthy_roads,
        COUNT(*) FILTER (WHERE wf.feature_type = 'road' AND fs.health < 30) AS degraded_roads
      FROM world_features AS wf
      JOIN feature_state AS fs ON fs.gers_id = wf.gers_id
      WHERE wf.region_id = $1
      `,
      [regionId]
    );

    const rustResult = await pool.query<{ rust_avg: number }>(
      "SELECT AVG(rust_level) AS rust_avg FROM hex_cells WHERE region_id = $1",
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
        rust_avg: Number(rustResult.rows[0]?.rust_avg ?? 0)
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

    const featuresResult = await pool.query<{
      gers_id: string;
      feature_type: string;
      geom: unknown;
      health: number | null;
      status: string | null;
      road_class: string | null;
      place_category: string | null;
      generates_labor: boolean;
      generates_materials: boolean;
    }>(
      `
      SELECT
        wf.gers_id,
        wf.feature_type,
        ST_AsGeoJSON(wf.geom)::json as geom,
        fs.health,
        fs.status,
        wf.road_class,
        wf.place_category,
        wf.generates_labor,
        wf.generates_materials
      FROM world_features AS wf
      LEFT JOIN feature_state AS fs ON fs.gers_id = wf.gers_id
      WHERE ST_Intersects(wf.geom, ST_MakeEnvelope($1, $2, $3, $4, 4326))
      ${typesClause}
      `,
      values
    );

    return { features: featuresResult.rows };
  });

  app.get("/api/hexes", async (request, reply) => {
    const query = request.query as { bbox?: string };
    const bbox = parseBBox(query.bbox);
    if (!bbox) {
      reply.status(400);
      return { ok: false, error: "invalid_bbox" };
    }

    const pool = getPool();
    const hexesResult = await pool.query<{
      h3_index: string;
      rust_level: number;
      boundary: unknown;
    }>(
      `
      SELECT
        h3_index,
        rust_level,
        ST_AsGeoJSON(h3_cell_to_boundary(h3_index))::json as boundary
      FROM hex_cells
      WHERE ST_Intersects(h3_cell_to_boundary(h3_index)::geometry, ST_MakeEnvelope($1, $2, $3, $4, 4326))
      `,
      bbox
    );

    return { hexes: hexesResult.rows };
  });

  app.post("/api/set-home", async (request, reply) => {
    const body = request.body as { client_id?: string; region_id?: string } | undefined;
    const clientId = body?.client_id?.trim();
    const regionId = body?.region_id?.trim();

    if (!clientId || !regionId) {
      reply.status(400);
      return { ok: false, error: "client_id_and_region_required" };
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
    } | undefined;

    const clientId = body?.client_id?.trim();
    const regionId = body?.region_id?.trim();
    const labor = Number(body?.labor ?? 0);
    const materials = Number(body?.materials ?? 0);

    if (!clientId || !regionId) {
      reply.status(400);
      return { ok: false, error: "client_id_and_region_required" };
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

      const regionUpdate = await pool.query<{
        pool_labor: number;
        pool_materials: number;
      }>(
        "UPDATE regions SET pool_labor = pool_labor + $2, pool_materials = pool_materials + $3, updated_at = now() WHERE region_id = $1 RETURNING pool_labor, pool_materials",
        [regionId, appliedLabor, appliedMaterials]
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
            taxed
          })
        ]
      );

      await pool.query("COMMIT");

      const updatedPools = regionUpdate.rows[0];

      return {
        ok: true,
        new_pool_labor: updatedPools?.pool_labor ?? 0,
        new_pool_materials: updatedPools?.pool_materials ?? 0,
        applied_labor: appliedLabor,
        applied_materials: appliedMaterials,
        remaining_labor: Math.max(0, remainingLabor - allowedLabor),
        remaining_materials: Math.max(0, remainingMaterials - allowedMaterials)
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

    if (!clientId || !taskId || ![1, -1].includes(weight)) {
      reply.status(400);
      return { ok: false, error: "invalid_vote" };
    }

    const pool = getPool();

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
        COALESCE(SUM(weight * EXP(-$2 * EXTRACT(EPOCH FROM (now() - created_at)) / 3600.0)), 0) AS vote_score
      FROM task_votes
      WHERE task_id = $1
      `,
      [taskId, LAMBDA]
    );

    const voteScore = Number(scoreResult.rows[0]?.vote_score ?? 0);

    await pool.query("UPDATE tasks SET vote_score = $2 WHERE task_id = $1", [taskId, voteScore]);

    return { ok: true, new_vote_score: voteScore };
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
        COALESCE(SUM(weight * EXP(-$2 * EXTRACT(EPOCH FROM (now() - created_at)) / 3600.0)), 0) AS vote_score
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

  app.addHook("onClose", async () => {
    await closePool();
  });

  return app;
}
