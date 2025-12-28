import type { Graph, GraphEdge, PathResult, Point, ConnectorCoords } from "./types.js";
import { DEGRADED_HEALTH_THRESHOLD } from "@nightfall/config";

/**
 * Calculate health-based slowdown multiplier.
 * - Roads above degraded threshold (healthy): max 3x slowdown
 * - Roads below threshold (degraded/repairable): max 2x slowdown
 */
export function healthSlowdownMultiplier(health: number): number {
  const baseMultiplier = 100 / Math.max(1, health);
  const maxMultiplier = health < DEGRADED_HEALTH_THRESHOLD ? 2 : 3;
  return Math.min(maxMultiplier, baseMultiplier);
}

/**
 * Calculate edge weight with health-based penalty.
 */
export function edgeWeight(lengthMeters: number, health: number): number {
  return lengthMeters * healthSlowdownMultiplier(health);
}

/**
 * Haversine distance between two points in meters.
 */
export function haversineDistanceMeters(a: Point, b: Point): number {
  const R = 6371e3; // Earth radius in meters
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Euclidean distance between two points (for heuristic).
 * Uses approximate meters based on lat/lng.
 */
function heuristicDistance(a: Point, b: Point): number {
  const dx = (b[0] - a[0]) * 111320 * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  const dy = (b[1] - a[1]) * 110540;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * A* pathfinding with health-weighted edges.
 */
export function findPath(
  graph: Graph,
  connectorCoords: ConnectorCoords,
  startConnector: string,
  endConnector: string
): PathResult | null {
  if (startConnector === endConnector) {
    return {
      connectorIds: [startConnector],
      segmentGersIds: [],
      segmentHealths: [],
      segmentLengths: [],
      totalDistance: 0,
      totalWeightedDistance: 0,
    };
  }

  const startCoord = connectorCoords.get(startConnector);
  const endCoord = connectorCoords.get(endConnector);
  if (!startCoord || !endCoord) {
    return null;
  }

  const openSet = new Set<string>([startConnector]);
  const cameFrom = new Map<string, { connector: string; edge: GraphEdge }>();
  const gScore = new Map<string, number>();
  const fScore = new Map<string, number>();

  gScore.set(startConnector, 0);
  fScore.set(startConnector, heuristicDistance(startCoord, endCoord));

  const getLowestFScore = (): string => {
    let bestKey = "";
    let bestScore = Infinity;
    for (const key of openSet) {
      const score = fScore.get(key) ?? Infinity;
      if (score < bestScore) {
        bestScore = score;
        bestKey = key;
      }
    }
    return bestKey;
  };

  while (openSet.size > 0) {
    const current = getLowestFScore();

    if (current === endConnector) {
      // Reconstruct path
      const connectorIds: string[] = [current];
      const segmentGersIds: string[] = [];
      const segmentHealths: number[] = [];
      const segmentLengths: number[] = [];
      let totalDistance = 0;
      let totalWeightedDistance = 0;

      let cursor = current;
      while (cameFrom.has(cursor)) {
        const { connector: parent, edge } = cameFrom.get(cursor)!;
        connectorIds.unshift(parent);
        segmentGersIds.unshift(edge.segmentGersId);
        segmentHealths.unshift(edge.health);
        segmentLengths.unshift(edge.lengthMeters);
        totalDistance += edge.lengthMeters;
        totalWeightedDistance += edgeWeight(edge.lengthMeters, edge.health);
        cursor = parent;
      }

      return {
        connectorIds,
        segmentGersIds,
        segmentHealths,
        segmentLengths,
        totalDistance,
        totalWeightedDistance,
      };
    }

    openSet.delete(current);
    const edges = graph.get(current);
    if (!edges) continue;

    const currentCoord = connectorCoords.get(current);
    if (!currentCoord) continue;

    for (const edge of edges) {
      const neighborCoord = connectorCoords.get(edge.toConnector);
      if (!neighborCoord) continue;

      const tentativeG =
        (gScore.get(current) ?? Infinity) + edgeWeight(edge.lengthMeters, edge.health);

      if (tentativeG < (gScore.get(edge.toConnector) ?? Infinity)) {
        cameFrom.set(edge.toConnector, { connector: current, edge });
        gScore.set(edge.toConnector, tentativeG);
        fScore.set(edge.toConnector, tentativeG + heuristicDistance(neighborCoord, endCoord));
        openSet.add(edge.toConnector);
      }
    }
  }

  return null; // No path found
}

/**
 * Find the nearest connector to a given point.
 * maxDistanceMeters should be large enough to find connectors across
 * the expanded hex search area (k=1 gridDisk covers ~3.5km diameter).
 */
export function findNearestConnector(
  connectorCoords: ConnectorCoords,
  point: Point,
  maxDistanceMeters: number = 2000
): string | null {
  let bestConnector: string | null = null;
  let bestDistance = Infinity;

  for (const [connectorId, coord] of connectorCoords) {
    const dist = heuristicDistance(point, coord);
    if (dist < bestDistance && dist <= maxDistanceMeters) {
      bestDistance = dist;
      bestConnector = connectorId;
    }
  }

  return bestConnector;
}

/**
 * Build waypoints with per-segment timestamps for animation.
 * Each waypoint includes arrival time based on cumulative travel.
 */
export function buildWaypoints(
  pathResult: PathResult,
  connectorCoords: ConnectorCoords,
  departAtMs: number,
  speedMps: number = 10
): { coord: Point; arrive_at: string }[] {
  let currentTimeMs = departAtMs;
  const waypoints: { coord: Point; arrive_at: string }[] = [];

  for (let i = 0; i < pathResult.connectorIds.length; i++) {
    const connectorId = pathResult.connectorIds[i];
    const coord = connectorCoords.get(connectorId);
    if (!coord) continue;

    waypoints.push({
      coord,
      arrive_at: new Date(currentTimeMs).toISOString(),
    });

    // Add travel time to next waypoint
    if (i < pathResult.segmentLengths.length) {
      const lengthMeters = pathResult.segmentLengths[i];
      const health = pathResult.segmentHealths[i];
      const healthMultiplier = healthSlowdownMultiplier(health);
      const segmentTimeMs = ((lengthMeters * healthMultiplier) / speedMps) * 1000;
      currentTimeMs += segmentTimeMs;
    }
  }

  return waypoints;
}
