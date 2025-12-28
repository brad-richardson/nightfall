/**
 * Graph and pathfinding service for road network traversal
 */

import { getPool } from "../db";
import { DEGRADED_HEALTH_THRESHOLD } from "@nightfall/config";
import type { Graph, ConnectorCoords } from "@nightfall/pathfinding";

// Graph cache per region (simple in-memory cache)
const graphCache = new Map<string, { graph: Graph; coords: ConnectorCoords; timestamp: number }>();
const GRAPH_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Focus hex cache - caches the hex with most degraded roads per region
const focusHexCache = new Map<string, { h3_index: string | null; timestamp: number }>();
const FOCUS_HEX_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

export function resetFocusHexCacheForTests() {
  focusHexCache.clear();
}

export async function loadGraphForRegion(
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

export async function getFocusHex(regionId: string): Promise<string | null> {
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
