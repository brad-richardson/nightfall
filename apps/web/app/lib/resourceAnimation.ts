/**
 * Resource Package Animation System
 *
 * Animates resource packages traveling from buildings along roads to hex centroids,
 * similar to Pokemon transfer animations.
 */

type Point = [number, number]; // [lng, lat]

export type ResourcePackage = {
  id: string;
  type: "labor" | "materials";
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
 * Calculate distance between two points
 */
function distance(a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return Math.sqrt(dx * dx + dy * dy);
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
  const path: Point[] = [buildingLocation];

  // Find closest point on road from building
  const startRoadPoint = findClosestRoadPoint(buildingLocation, roads);
  if (!startRoadPoint) {
    // No roads, just go direct
    path.push(hexCentroid);
    return path;
  }

  path.push(startRoadPoint);

  // Greedy pathfinding along roads toward centroid
  // Collect all road segment endpoints
  const allPoints: Point[] = [];
  const pointToRoads: Map<string, number[][]> = new Map();

  roads.forEach((road) => {
    const coords = road.geometry.coordinates as Point[];
    coords.forEach((coord, i) => {
      const key = `${coord[0].toFixed(6)},${coord[1].toFixed(6)}`;
      if (!pointToRoads.has(key)) {
        pointToRoads.set(key, []);
        allPoints.push(coord);
      }
      // Store connections to next point in segment
      if (i < coords.length - 1) {
        pointToRoads.get(key)!.push(coords[i + 1]);
      }
      if (i > 0) {
        pointToRoads.get(key)!.push(coords[i - 1]);
      }
    });
  });

  // Simple greedy: from current point, find connected point closest to destination
  let current = startRoadPoint;
  const visited = new Set<string>();
  let iterations = 0;
  const maxIterations = 50; // Prevent infinite loops

  while (iterations < maxIterations) {
    iterations++;
    const currentKey = `${current[0].toFixed(6)},${current[1].toFixed(6)}`;

    // If we're close enough to centroid, break
    if (distance(current, hexCentroid) < 0.001) break;

    visited.add(currentKey);

    // Find closest connected point that moves us toward centroid
    let bestNext: Point | null = null;
    let bestScore = Infinity;

    // Look for nearby road points
    for (const point of allPoints) {
      const pointKey = `${point[0].toFixed(6)},${point[1].toFixed(6)}`;
      if (visited.has(pointKey)) continue;

      // Check if this point is reasonably close to current
      const distToCurrent = distance(current, point);
      if (distToCurrent > 0.005) continue; // Skip points too far away

      // Score: distance to destination + distance from current
      const score = distance(point, hexCentroid) + distToCurrent * 0.5;
      if (score < bestScore) {
        bestScore = score;
        bestNext = point;
      }
    }

    if (!bestNext) break;

    // If the next point is further from destination than just going direct, stop
    if (distance(bestNext, hexCentroid) > distance(current, hexCentroid) + 0.001) {
      break;
    }

    path.push(bestNext);
    current = bestNext;
  }

  // Finally, add the centroid
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
