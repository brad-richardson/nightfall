export type Point = [number, number]; // [lng, lat]

export type Graph = {
  nodes: Map<string, Point>;
  edges: Map<string, Set<string>>;
};

export const DEFAULT_PRECISION = 6;
export const DEFAULT_MAX_SNAP_DISTANCE = 0.01;

export type RouteResult = {
  pathKeys: string[];
  pathPoints: Point[];
  pathEdges: Array<[Point, Point]>;
  startKey: string;
  endKey: string;
  startDistance: number;
  endDistance: number;
};

export function distance(a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return Math.sqrt(dx * dx + dy * dy);
}

export function makeKey(point: Point, precision: number = DEFAULT_PRECISION): string {
  return `${point[0].toFixed(precision)},${point[1].toFixed(precision)}`;
}

export function buildRoadGraph(
  roads: { geometry: { coordinates: number[][] } }[],
  precision: number = DEFAULT_PRECISION
): Graph {
  const nodes = new Map<string, Point>();
  const edges = new Map<string, Set<string>>();

  for (const road of roads) {
    const coords = road.geometry.coordinates as Point[];
    for (let i = 0; i < coords.length; i += 1) {
      const point = coords[i];
      const key = makeKey(point, precision);
      if (!nodes.has(key)) {
        nodes.set(key, point);
        edges.set(key, new Set());
      }

      if (i > 0) {
        const prev = coords[i - 1];
        const prevKey = makeKey(prev, precision);
        nodes.set(prevKey, prev);
        edges.get(key)?.add(prevKey);
        edges.get(prevKey)?.add(key);
      }
    }
  }

  return { nodes, edges };
}

export function findNearestNode(point: Point, graph: Graph): { key: string; distance: number } | null {
  let bestKey: string | null = null;
  let bestDist = Infinity;

  for (const [key, node] of graph.nodes.entries()) {
    const dist = distance(point, node);
    if (dist < bestDist) {
      bestDist = dist;
      bestKey = key;
    }
  }

  if (!bestKey) return null;
  return { key: bestKey, distance: bestDist };
}

export function findPathKeys(graph: Graph, startKey: string, goalKey: string): string[] | null {
  if (startKey === goalKey) return [startKey];

  const openSet = new Set([startKey]);
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>();
  const fScore = new Map<string, number>();

  gScore.set(startKey, 0);
  fScore.set(startKey, distance(graph.nodes.get(startKey)!, graph.nodes.get(goalKey)!));

  const getLowest = () => {
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
    const current = getLowest();
    if (current === goalKey) {
      const path: string[] = [current];
      let cursor = current;
      while (cameFrom.has(cursor)) {
        const parent = cameFrom.get(cursor);
        if (!parent) break;
        path.unshift(parent);
        cursor = parent;
      }
      return path;
    }

    openSet.delete(current);
    const neighbors = graph.edges.get(current);
    if (!neighbors) continue;

    for (const neighbor of neighbors) {
      const tentative =
        (gScore.get(current) ?? Infinity) +
        distance(graph.nodes.get(current)!, graph.nodes.get(neighbor)!);

      if (tentative < (gScore.get(neighbor) ?? Infinity)) {
        cameFrom.set(neighbor, current);
        gScore.set(neighbor, tentative);
        fScore.set(
          neighbor,
          tentative + distance(graph.nodes.get(neighbor)!, graph.nodes.get(goalKey)!)
        );
        openSet.add(neighbor);
      }
    }
  }

  return null;
}

export function buildPathPoints(graph: Graph, pathKeys: string[]): Point[] {
  return pathKeys
    .map((key) => graph.nodes.get(key))
    .filter((point): point is Point => Boolean(point));
}

export function buildPathEdges(graph: Graph, pathKeys: string[]): Array<[Point, Point]> {
  const points = buildPathPoints(graph, pathKeys);
  const edges: Array<[Point, Point]> = [];

  for (let i = 0; i < points.length - 1; i += 1) {
    edges.push([points[i], points[i + 1]]);
  }

  return edges;
}

export function routeGraph(
  graph: Graph,
  startPoint: Point,
  endPoint: Point,
  options: { maxSnapDistance?: number } = {}
): RouteResult | null {
  if (graph.nodes.size === 0) return null;

  const maxSnapDistance = options.maxSnapDistance ?? 1.0; // Very lenient default
  const startNode = findNearestNode(startPoint, graph);
  const endNode = findNearestNode(endPoint, graph);

  if (!startNode || !endNode) return null;
  if (startNode.distance > maxSnapDistance || endNode.distance > maxSnapDistance) return null;

  const pathKeys = findPathKeys(graph, startNode.key, endNode.key);
  if (!pathKeys || pathKeys.length === 0) return null;

  const pathPoints = buildPathPoints(graph, pathKeys);
  const pathEdges = buildPathEdges(graph, pathKeys);

  return {
    pathKeys,
    pathPoints,
    pathEdges,
    startKey: startNode.key,
    endKey: endNode.key,
    startDistance: startNode.distance,
    endDistance: endNode.distance
  };
}
