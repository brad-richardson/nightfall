/**
 * Resource Package Animation System
 *
 * Animates resource packages traveling from buildings along roads to hex centroids,
 * similar to Pokemon transfer animations.
 */

import {
  type Point,
  buildRoadGraph,
  distance,
  routeGraph
} from "./roadRouting";

export type PathWaypoint = {
  coord: [number, number];
  arrive_at: string;
};

export type ResourcePackage = {
  id: string;
  type: "food" | "equipment" | "energy" | "materials";
  path: Point[];
  progress: number; // 0-1
  startTime: number;
  duration: number; // ms
  waypoints?: PathWaypoint[] | null; // Server-provided waypoints for time-based animation
};

/**
 * Find the closest point on a line segment to a given point
 */
function closestPointOnSegment(point: Point, segStart: Point, segEnd: Point): Point {
  const [px, py] = point;
  const [ax, ay] = segStart;
  const [bx, by] = segEnd;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) return segStart;

  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  return [ax + t * dx, ay + t * dy];
}

/**
 * Find the closest point on any road to the given point
 */
export function findClosestRoadPoint(
  point: Point,
  roads: { geometry: { coordinates: number[][] } }[]
): Point | null {
  let closestPoint: Point | null = null;
  let minDist = Infinity;

  for (const road of roads) {
    const coords = road.geometry.coordinates as Point[];
    for (let i = 0; i < coords.length - 1; i++) {
      const closest = closestPointOnSegment(point, coords[i], coords[i + 1]);
      const dist = distance(point, closest);
      if (dist < minDist) {
        minDist = dist;
        closestPoint = closest;
      }
    }
  }

  return closestPoint;
}

/**
 * Build a simple path from building to centroid using road segments
 * Uses a greedy approach: always move toward the destination along roads
 */
export function buildResourcePath(
  buildingLocation: Point,
  hexCentroid: Point,
  roads: { geometry: { coordinates: number[][] } }[]
): Point[] {
  const directPath: Point[] = [buildingLocation, hexCentroid];
  if (roads.length === 0) {
    console.debug("[buildResourcePath] No roads provided for routing");
    return directPath;
  }

  const startRoadPoint = findClosestRoadPoint(buildingLocation, roads);
  const endRoadPoint = findClosestRoadPoint(hexCentroid, roads);

  if (!startRoadPoint || !endRoadPoint) {
    console.debug("[buildResourcePath] Could not find start or end road points", { startRoadPoint, endRoadPoint });
    return directPath;
  }

  const graph = buildRoadGraph(roads);
  if (graph.nodes.size === 0) {
    console.debug("[buildResourcePath] Road graph is empty");
    return directPath;
  }

  const route = routeGraph(graph, startRoadPoint, endRoadPoint);
  if (!route) {
    console.debug("[buildResourcePath] No path found between road points", { startRoadPoint, endRoadPoint });
    return [buildingLocation, startRoadPoint, endRoadPoint, hexCentroid];
  }

  const pathOnRoad = route.pathPoints;
  const path: Point[] = [buildingLocation, startRoadPoint];
  for (const point of pathOnRoad) {
    const last = path[path.length - 1];
    if (!last || distance(last, point) > 0.000001) {
      path.push(point);
    }
  }

  const last = path[path.length - 1];
  if (last && distance(last, endRoadPoint) > 0.000001) {
    path.push(endRoadPoint);
  }

  path.push(hexCentroid);
  return path;
}

/**
 * Cached path data for efficient interpolation
 */
export type CachedPath = {
  path: Point[];
  segmentLengths: number[];
  totalLength: number;
};

// LRU cache for path segment data - uses Map insertion order for LRU tracking
const pathCache = new Map<Point[], CachedPath>();
const MAX_PATH_CACHE_SIZE = 100;

/**
 * Get or compute cached path data (segment lengths and total length)
 * Uses LRU eviction: accessed entries are moved to end, oldest entries evicted first
 */
function getCachedPathData(path: Point[]): CachedPath {
  const cached = pathCache.get(path);
  if (cached) {
    // Move to end for LRU tracking (delete + re-insert)
    pathCache.delete(path);
    pathCache.set(path, cached);
    return cached;
  }

  // Compute segment lengths
  let totalLength = 0;
  const segmentLengths: number[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const len = distance(path[i], path[i + 1]);
    segmentLengths.push(len);
    totalLength += len;
  }

  const data: CachedPath = { path, segmentLengths, totalLength };

  // LRU eviction: remove oldest (first) entry when at capacity
  if (pathCache.size >= MAX_PATH_CACHE_SIZE) {
    const firstKey = pathCache.keys().next().value;
    if (firstKey) pathCache.delete(firstKey);
  }

  pathCache.set(path, data);
  return data;
}

/**
 * Clear the path cache (useful when paths are updated)
 */
export function clearPathCache(): void {
  pathCache.clear();
}

/**
 * Interpolate position along a path based on progress (0-1)
 * Uses cached segment lengths to avoid recalculating on every frame
 */
export function interpolatePath(path: Point[], progress: number): Point {
  if (path.length === 0) return [0, 0];
  if (path.length === 1) return path[0];
  if (progress <= 0) return path[0];
  if (progress >= 1) return path[path.length - 1];

  // Get cached segment data
  const { segmentLengths, totalLength } = getCachedPathData(path);

  // Find target distance
  const targetDist = progress * totalLength;
  let accum = 0;

  for (let i = 0; i < segmentLengths.length; i++) {
    if (accum + segmentLengths[i] >= targetDist) {
      // Interpolate within this segment
      const segProgress = (targetDist - accum) / segmentLengths[i];
      const [ax, ay] = path[i];
      const [bx, by] = path[i + 1];
      return [
        ax + (bx - ax) * segProgress,
        ay + (by - ay) * segProgress
      ];
    }
    accum += segmentLengths[i];
  }

  return path[path.length - 1];
}

/**
 * Easing function for smooth animation
 */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Interpolate position along waypoints based on current time.
 * Uses per-waypoint timestamps for variable-speed animation (visible slowdowns on degraded roads).
 * Returns null if animation is complete.
 */
export function interpolateWaypoints(waypoints: PathWaypoint[], now: number): Point | null {
  if (waypoints.length === 0) return null;
  if (waypoints.length === 1) return waypoints[0].coord;

  const firstTime = Date.parse(waypoints[0].arrive_at);
  const lastTime = Date.parse(waypoints[waypoints.length - 1].arrive_at);

  // Before start
  if (now < firstTime) return waypoints[0].coord;

  // After end - return final position for fade-out grace period
  // The animation loop handles removal based on progress
  if (now >= lastTime) return waypoints[waypoints.length - 1].coord;

  // Find which segment we're in based on current time
  for (let i = 0; i < waypoints.length - 1; i++) {
    const startTime = Date.parse(waypoints[i].arrive_at);
    const endTime = Date.parse(waypoints[i + 1].arrive_at);

    if (now >= startTime && now < endTime) {
      // Interpolate within this segment
      const segmentProgress = (now - startTime) / (endTime - startTime);
      const [ax, ay] = waypoints[i].coord;
      const [bx, by] = waypoints[i + 1].coord;
      return [
        ax + (bx - ax) * segmentProgress,
        ay + (by - ay) * segmentProgress
      ];
    }
  }

  return null; // Animation complete
}
