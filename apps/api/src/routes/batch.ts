/**
 * Batch fetch endpoints with caching for ID-only SSE notifications.
 * These endpoints return persisted data (waypoints, etc.) computed at dispatch time.
 * Cache-Control: public, max-age=10 allows browser/CDN caching.
 */

import type { FastifyInstance, FastifyReply } from "fastify";
import { getPool } from "../db";

const CACHE_MAX_AGE = 10; // seconds
const MAX_IDS_PER_REQUEST = 100;

function setCacheHeaders(reply: FastifyReply) {
  reply.header("Cache-Control", `public, max-age=${CACHE_MAX_AGE}`);
}

function parseIds(idsParam: string | undefined): string[] | null {
  if (!idsParam) return null;
  const ids = idsParam.split(",").map(id => id.trim()).filter(Boolean);
  if (ids.length === 0 || ids.length > MAX_IDS_PER_REQUEST) return null;
  return ids;
}

export function registerBatchRoutes(app: FastifyInstance) {
  /**
   * GET /api/batch/crews?ids=id1,id2,id3
   * Returns crews with persisted waypoints (computed at dispatch time)
   */
  app.get<{ Querystring: { ids?: string } }>("/api/batch/crews", async (request, reply) => {
    const ids = parseIds(request.query.ids);
    if (!ids) {
      reply.status(400);
      return { ok: false, error: "invalid_ids", message: "Provide 1-100 comma-separated IDs" };
    }

    setCacheHeaders(reply);
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
      busy_until: string | null;
    }>(
      `SELECT
        crew_id,
        region_id,
        status,
        active_task_id,
        current_lng,
        current_lat,
        waypoints,
        path_started_at::text,
        busy_until::text
      FROM crews
      WHERE crew_id = ANY($1::uuid[])`,
      [ids]
    );

    return {
      crews: result.rows.map(row => ({
        crew_id: row.crew_id,
        region_id: row.region_id,
        status: row.status,
        task_id: row.active_task_id,
        position: row.current_lng != null && row.current_lat != null
          ? { lng: row.current_lng, lat: row.current_lat }
          : null,
        waypoints: row.waypoints,
        path_started_at: row.path_started_at,
        busy_until: row.busy_until
      }))
    };
  });

  /**
   * GET /api/batch/hexes?ids=h3_1,h3_2,h3_3
   * Returns hex cells with rust levels
   */
  app.get<{ Querystring: { ids?: string } }>("/api/batch/hexes", async (request, reply) => {
    const ids = parseIds(request.query.ids);
    if (!ids) {
      reply.status(400);
      return { ok: false, error: "invalid_ids", message: "Provide 1-100 comma-separated IDs" };
    }

    setCacheHeaders(reply);
    const pool = getPool();

    const result = await pool.query<{
      h3_index: string;
      rust_level: number;
      region_id: string;
    }>(
      `SELECT h3_index, rust_level::float, region_id
       FROM hex_cells
       WHERE h3_index = ANY($1::text[])`,
      [ids]
    );

    return {
      hexes: result.rows.map(row => ({
        h3_index: row.h3_index,
        rust_level: row.rust_level,
        region_id: row.region_id
      }))
    };
  });

  /**
   * GET /api/batch/features?ids=gers_1,gers_2
   * Returns feature health and status
   */
  app.get<{ Querystring: { ids?: string } }>("/api/batch/features", async (request, reply) => {
    const ids = parseIds(request.query.ids);
    if (!ids) {
      reply.status(400);
      return { ok: false, error: "invalid_ids", message: "Provide 1-100 comma-separated IDs" };
    }

    setCacheHeaders(reply);
    const pool = getPool();

    const result = await pool.query<{
      gers_id: string;
      region_id: string;
      health: number | null;
      status: string | null;
    }>(
      `SELECT
        wf.gers_id,
        wf.region_id,
        fs.health,
        fs.status
      FROM world_features wf
      LEFT JOIN feature_state fs ON fs.gers_id = wf.gers_id
      WHERE wf.gers_id = ANY($1::text[])`,
      [ids]
    );

    return {
      features: result.rows.map(row => ({
        gers_id: row.gers_id,
        region_id: row.region_id,
        health: row.health,
        status: row.status
      }))
    };
  });

  /**
   * GET /api/batch/transfers?ids=transfer_1,transfer_2
   * Returns resource transfers with persisted path_waypoints
   */
  app.get<{ Querystring: { ids?: string } }>("/api/batch/transfers", async (request, reply) => {
    const ids = parseIds(request.query.ids);
    if (!ids) {
      reply.status(400);
      return { ok: false, error: "invalid_ids", message: "Provide 1-100 comma-separated IDs" };
    }

    setCacheHeaders(reply);
    const pool = getPool();

    const result = await pool.query<{
      transfer_id: string;
      region_id: string;
      source_gers_id: string | null;
      hub_gers_id: string | null;
      resource_type: string;
      amount: number;
      depart_at: string;
      arrive_at: string;
      path_waypoints: unknown;
      status: string;
    }>(
      `SELECT
        transfer_id,
        region_id,
        source_gers_id,
        hub_gers_id,
        resource_type,
        amount,
        depart_at::text,
        arrive_at::text,
        path_waypoints,
        status
      FROM resource_transfers
      WHERE transfer_id = ANY($1::uuid[])`,
      [ids]
    );

    return {
      transfers: result.rows.map(row => ({
        transfer_id: row.transfer_id,
        region_id: row.region_id,
        source_gers_id: row.source_gers_id,
        hub_gers_id: row.hub_gers_id,
        resource_type: row.resource_type,
        amount: row.amount,
        depart_at: row.depart_at,
        arrive_at: row.arrive_at,
        path_waypoints: row.path_waypoints,
        status: row.status
      }))
    };
  });
}
