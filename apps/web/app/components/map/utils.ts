import type { Feature, Boundary, Bbox } from "./types";

/**
 * Get the center point of a feature
 */
export function getFeatureCenter(feature: Feature): [number, number] | null {
  if (feature.bbox) {
    return [
      (feature.bbox[0] + feature.bbox[2]) / 2,
      (feature.bbox[1] + feature.bbox[3]) / 2
    ];
  }

  if (!feature.geometry) return null;

  const g = feature.geometry;
  if (g.type === "Point") return g.coordinates as [number, number];
  if (g.type === "LineString") {
    const coords = g.coordinates as number[][];
    if (coords.length === 0) return null;
    const mid = coords[Math.floor(coords.length / 2)];
    return [mid[0], mid[1]];
  }
  if (g.type === "MultiLineString") {
    const lines = g.coordinates as number[][][];
    const firstLine = lines[0];
    if (!firstLine || firstLine.length === 0) return null;
    const mid = firstLine[Math.floor(firstLine.length / 2)];
    return [mid[0], mid[1]];
  }
  if (g.type === "Polygon") {
    const ring = (g.coordinates as number[][][])[0];
    if (!ring?.length) return null;
    const sumLng = ring.reduce((s, c) => s + c[0], 0);
    const sumLat = ring.reduce((s, c) => s + c[1], 0);
    return [sumLng / ring.length, sumLat / ring.length];
  }
  if (g.type === "MultiPolygon") {
    const ring = (g.coordinates as number[][][][])[0]?.[0];
    if (!ring?.length) return null;
    const sumLng = ring.reduce((s, c) => s + c[0], 0);
    const sumLat = ring.reduce((s, c) => s + c[1], 0);
    return [sumLng / ring.length, sumLat / ring.length];
  }
  return null;
}

/**
 * Get the nearest hub center to a target point
 */
export function getNearestHubCenter(
  features: Feature[],
  target?: [number, number] | null
): [number, number] | null {
  const hubs = features.filter((f) => f.feature_type === "building" && f.is_hub);
  if (hubs.length === 0) return null;

  let bestCenter: [number, number] | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const hub of hubs) {
    const center = getFeatureCenter(hub);
    if (!center) continue;
    if (!target) return center;
    const dx = center[0] - target[0];
    const dy = center[1] - target[1];
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestCenter = center;
    }
  }

  return bestCenter;
}

/**
 * Calculate fallback center from bbox
 */
export function getFallbackCenter(bbox: Bbox): [number, number] {
  return [
    (bbox.xmin + bbox.xmax) / 2,
    (bbox.ymin + bbox.ymax) / 2
  ];
}

/**
 * Calculate max bounds from boundary
 */
export function getMaxBoundsFromBoundary(
  boundary: Boundary | null
): [[number, number], [number, number]] | undefined {
  if (!boundary) return undefined;

  const coords = boundary.type === "Polygon"
    ? boundary.coordinates.flat()
    : boundary.coordinates.flat(2);

  if (coords.length === 0) return undefined;

  let xmin = Number.POSITIVE_INFINITY;
  let ymin = Number.POSITIVE_INFINITY;
  let xmax = Number.NEGATIVE_INFINITY;
  let ymax = Number.NEGATIVE_INFINITY;

  for (const [lon, lat] of coords) {
    xmin = Math.min(xmin, lon);
    ymin = Math.min(ymin, lat);
    xmax = Math.max(xmax, lon);
    ymax = Math.max(ymax, lat);
  }

  // Add a buffer (0.05 degrees) so the user can pan slightly outside
  return [
    [xmin - 0.05, ymin - 0.05],
    [xmax + 0.05, ymax + 0.05]
  ];
}

/**
 * Extract road features for path building
 */
export function extractRoadFeaturesForPath(
  features: Feature[]
): { geometry: { coordinates: number[][] } }[] {
  const roads: { geometry: { coordinates: number[][] } }[] = [];
  for (const feature of features) {
    if (feature.feature_type !== "road" || !feature.geometry) continue;
    if (feature.geometry.type === "LineString") {
      roads.push({ geometry: { coordinates: feature.geometry.coordinates as number[][] } });
    } else if (feature.geometry.type === "MultiLineString") {
      const multiCoords = feature.geometry.coordinates as number[][][];
      for (const line of multiCoords) {
        roads.push({ geometry: { coordinates: line } });
      }
    }
  }
  return roads;
}

/**
 * Normalize health value to percentage (0-100)
 */
export function normalizePercent(value: number | null | undefined): number {
  if (value === null || value === undefined || Number.isNaN(value)) return 0;
  return value <= 1 ? value * 100 : value;
}

/**
 * Make an ID filter expression for MapLibre
 */
export function makeIdFilter(
  ids: string[]
): ["in", ["get", string], ["literal", string[]]] {
  return ["in", ["get", "id"], ["literal", ids.length ? ids : ["__none__"]]];
}
