import type { Graph, GraphEdge, PathResult, Point, ConnectorCoords } from "./types.js";

/**
 * Calculate health-based slowdown multiplier.
 * - Healthy roads (100%): 1x speed
 * - Degraded roads (70%): ~1.4x slower
 * - Very damaged roads (33%): 3x slower (capped)
 */
export function healthSlowdownMultiplier(health: number): number {
  const baseMultiplier = 100 / Math.max(1, health);
  // Cap at 3x slowdown to ensure paths can always be found
  return Math.min(3, baseMultiplier);
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
 * Increased to 5000m to handle region edges where connectors may be sparse.
 */
export function findNearestConnector(
  connectorCoords: ConnectorCoords,
  point: Point,
  maxDistanceMeters: number = 5000
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
 * Options for building waypoints with off-road start/end points.
 */
export type BuildWaypointsOptions = {
  /** Actual starting point (e.g., building location) - path will start here before joining the road */
  actualStart?: Point;
  /** Actual ending point (e.g., destination building) - path will end here after leaving the road */
  actualEnd?: Point;
};

/**
 * Build waypoints with per-segment timestamps for animation.
 * Each waypoint includes arrival time based on cumulative travel.
 *
 * If actualStart/actualEnd are provided, the path will include segments
 * from the actual start point to the first road connector, and from the
 * last road connector to the actual end point.
 */
export function buildWaypoints(
  pathResult: PathResult,
  connectorCoords: ConnectorCoords,
  departAtMs: number,
  speedMps: number = 10,
  options: BuildWaypointsOptions = {}
): { coord: Point; arrive_at: string }[] {
  let currentTimeMs = departAtMs;
  const waypoints: { coord: Point; arrive_at: string }[] = [];
  const { actualStart, actualEnd } = options;

  // If we have an actual start point, add it first and calculate time to first connector
  if (actualStart) {
    waypoints.push({
      coord: actualStart,
      arrive_at: new Date(currentTimeMs).toISOString(),
    });

    // Get first connector coordinate to calculate travel time
    if (pathResult.connectorIds.length > 0) {
      const firstConnectorCoord = connectorCoords.get(pathResult.connectorIds[0]);
      if (firstConnectorCoord) {
        const distToConnector = haversineDistanceMeters(actualStart, firstConnectorCoord);
        const timeToConnectorMs = (distToConnector / speedMps) * 1000;
        currentTimeMs += timeToConnectorMs;
      }
    }
  }

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

  // If we have an actual end point, add it last with travel time from last connector
  if (actualEnd) {
    if (pathResult.connectorIds.length > 0) {
      const lastConnectorCoord = connectorCoords.get(
        pathResult.connectorIds[pathResult.connectorIds.length - 1]
      );
      if (lastConnectorCoord) {
        const distFromConnector = haversineDistanceMeters(lastConnectorCoord, actualEnd);
        const timeFromConnectorMs = (distFromConnector / speedMps) * 1000;
        currentTimeMs += timeFromConnectorMs;
      }
    }

    waypoints.push({
      coord: actualEnd,
      arrive_at: new Date(currentTimeMs).toISOString(),
    });
  }

  return waypoints;
}

/**
 * Perpendicular distance from a point to a line segment.
 */
function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const dx = lineEnd[0] - lineStart[0];
  const dy = lineEnd[1] - lineStart[1];
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return haversineDistanceMeters(point, lineStart);
  }

  // Project point onto line segment
  const t = Math.max(0, Math.min(1,
    ((point[0] - lineStart[0]) * dx + (point[1] - lineStart[1]) * dy) / lengthSquared
  ));

  const projected: Point = [
    lineStart[0] + t * dx,
    lineStart[1] + t * dy
  ];

  return haversineDistanceMeters(point, projected);
}

/**
 * Ramer-Douglas-Peucker algorithm to simplify a path.
 * Reduces waypoint count while preserving overall shape.
 *
 * @param waypoints - Array of waypoints to simplify
 * @param epsilon - Maximum distance (meters) a point can deviate from the simplified line
 * @returns Simplified waypoints array
 */
export function simplifyWaypoints<T extends { coord: Point }>(
  waypoints: T[],
  epsilon: number = 10
): T[] {
  if (waypoints.length <= 2) {
    return waypoints;
  }

  // Find the point with maximum distance from the line segment
  let maxDistance = 0;
  let maxIndex = 0;
  const startCoord = waypoints[0].coord;
  const endCoord = waypoints[waypoints.length - 1].coord;

  for (let i = 1; i < waypoints.length - 1; i++) {
    const distance = perpendicularDistance(waypoints[i].coord, startCoord, endCoord);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }

  // If max distance is greater than epsilon, recursively simplify
  if (maxDistance > epsilon) {
    const left = simplifyWaypoints(waypoints.slice(0, maxIndex + 1), epsilon);
    const right = simplifyWaypoints(waypoints.slice(maxIndex), epsilon);

    // Combine results, avoiding duplicate at join point
    return [...left.slice(0, -1), ...right];
  }

  // All points are within epsilon, return just start and end
  return [waypoints[0], waypoints[waypoints.length - 1]];
}
