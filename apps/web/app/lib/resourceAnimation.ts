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

export type ResourcePackage = {
  id: string;
  type: "food" | "equipment" | "energy" | "materials";
  path: Point[];
  progress: number; // 0-1
  startTime: number;
  duration: number; // ms
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
 * Interpolate position along a path based on progress (0-1)
 */
export function interpolatePath(path: Point[], progress: number): Point {
  if (path.length === 0) return [0, 0];
  if (path.length === 1) return path[0];
  if (progress <= 0) return path[0];
  if (progress >= 1) return path[path.length - 1];

  // Calculate total path length
  let totalLength = 0;
  const segmentLengths: number[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const len = distance(path[i], path[i + 1]);
    segmentLengths.push(len);
    totalLength += len;
  }

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
