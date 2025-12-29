/**
 * World-related routes: world, region, features, hexes, crews
 */

import type { FastifyInstance } from "fastify";
import { getPool } from "../db";
import { loadCycleState } from "../cycle";
import { parseBBox, parseTypes, getNextReset } from "../utils/helpers";
import { getFocusHex } from "../services/graph";
import {
  DEGRADED_HEALTH_THRESHOLD,
  calculateCityScore
} from "@nightfall/config";

export function registerWorldRoutes(app: FastifyInstance) {
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

  // Get backbone road geometries for a region (tier 1 roads with health info)
  // Returns GeoJSON FeatureCollection for client overlay rendering
  app.get<{ Params: { region_id: string } }>("/api/region/:region_id/backbone", async (request, reply) => {
    const regionId = request.params.region_id;
    const pool = getPool();

    // Verify region exists
    const regionCheck = await pool.query(
      "SELECT 1 FROM regions WHERE region_id = $1",
      [regionId]
    );
    if (regionCheck.rows.length === 0) {
      reply.status(404);
      return { ok: false, error: "region_not_found" };
    }

    // Get tier 1 backbone roads with their geometries and health info
    // Uses the geom column (LineString) for rendering the backbone overlay
    const backboneResult = await pool.query<{
      gers_id: string;
      road_class: string | null;
      health: number;
      status: string | null;
      geometry: unknown;
    }>(
      `
      SELECT
        wf.gers_id,
        wf.road_class,
        COALESCE(fs.health, 100)::float AS health,
        fs.status,
        ST_AsGeoJSON(wf.geom)::json AS geometry
      FROM world_features wf
      LEFT JOIN feature_state fs ON fs.gers_id = wf.gers_id
      WHERE wf.region_id = $1
        AND wf.feature_type = 'road'
        AND wf.backbone_tier = 1
        AND wf.geom IS NOT NULL
      `,
      [regionId]
    );

    // Return as GeoJSON FeatureCollection
    const features = backboneResult.rows.map(row => ({
      type: "Feature" as const,
      properties: {
        gers_id: row.gers_id,
        road_class: row.road_class,
        health: row.health,
        status: row.status
      },
      geometry: row.geometry
    }));

    // Set long cache TTL since backbone doesn't change during gameplay
    reply.header("Cache-Control", "public, max-age=300");

    return {
      type: "FeatureCollection",
      features
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

    // Resource generation flags are set at ingest time, no runtime pattern matching needed
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
      last_activated_at: string | null;
      backbone_tier: number | null;
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
        wf.generates_food,
        wf.generates_equipment,
        wf.generates_energy,
        wf.generates_materials,
        EXISTS (
          SELECT 1 FROM hex_cells hc WHERE hc.hub_building_gers_id = wf.gers_id
        ) AS is_hub,
        fs.last_activated_at::text,
        wf.backbone_tier::int
      FROM world_features AS wf
      LEFT JOIN feature_state AS fs ON fs.gers_id = wf.gers_id
      WHERE wf.bbox_xmin <= $3
        AND wf.bbox_xmax >= $1
        AND wf.bbox_ymin <= $4
        AND wf.bbox_ymax >= $2
      ${typesClause}
      `,
      values
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
}
