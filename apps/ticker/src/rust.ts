import * as h3 from "h3-js";
import type { PoolLike } from "./ticker";
import type { PhaseMultipliers } from "./multipliers";

const DEFAULT_BASE_SPREAD = 0.002;
const MAX_RUST_LEVEL = 0.95;

export type RustCell = {
  h3_index: string;
  rust_level: number;
  distance_from_center: number;
};

type RoadStats = {
  healthy: number;
  total: number;
};

type ComputeArgs = {
  cells: RustCell[];
  roadStats: Map<string, RoadStats>;
  multipliers: PhaseMultipliers;
  baseSpread: number;
  getNeighbors: (index: string) => string[];
};

export type RustUpdate = {
  h3_index: string;
  rust_level: number;
};

export function computeRustUpdates({
  cells,
  roadStats,
  multipliers,
  baseSpread,
  getNeighbors
}: ComputeArgs) {
  const rustByIndex = new Map(cells.map((cell) => [cell.h3_index, cell.rust_level]));
  const updates: RustUpdate[] = [];
  const pushbackMult = Math.max(0, 1.5 - multipliers.rust_spread);

  for (const cell of cells) {
    const current = cell.rust_level;
    const stats = roadStats.get(cell.h3_index);
    const healthRatio = stats && stats.total > 0 ? stats.healthy / stats.total : 0;
    const pushback = 0.005 * healthRatio * pushbackMult;
    let next = current;

    if (cell.distance_from_center > 0) {
      const neighbors = getNeighbors(cell.h3_index);
      let neighborMax = current;
      for (const neighbor of neighbors) {
        const neighborRust = rustByIndex.get(neighbor);
        if (typeof neighborRust === "number") {
          neighborMax = Math.max(neighborMax, neighborRust);
        }
      }

      if (neighborMax > current) {
        const spread = baseSpread * (neighborMax - current) * multipliers.rust_spread;
        next += spread;
      }
    }

    next -= pushback;
    next = Math.max(0, Math.min(MAX_RUST_LEVEL, next));

    if (Math.abs(next - current) > 1e-6) {
      updates.push({ h3_index: cell.h3_index, rust_level: next });
    }
  }

  return updates;
}

function getNeighborIndexes(index: string) {
  const gridDisk = (h3 as { gridDisk?: (h: string, k: number) => string[] }).gridDisk;
  const kRing = (h3 as { kRing?: (h: string, k: number) => string[] }).kRing;
  const ringFn = gridDisk ?? kRing;

  if (!ringFn) {
    return [];
  }

  try {
    return ringFn(index, 1).filter((neighbor) => neighbor !== index);
  } catch {
    return [];
  }
}

export async function applyRustSpread(pool: PoolLike, multipliers: PhaseMultipliers): Promise<RustUpdate[]> {
  const cellsResult = await pool.query<RustCell>(
    "SELECT h3_index, rust_level, distance_from_center FROM hex_cells FOR UPDATE"
  );
  const cells = cellsResult.rows;

  if (cells.length === 0) {
    return [];
  }

  const roadStatsResult = await pool.query<{
    h3_index: string;
    healthy_count: number;
    total_count: number;
  }>(
    `
    SELECT
      wfhc.h3_index,
      COUNT(*) FILTER (WHERE fs.health > 80) AS healthy_count,
      COUNT(*) AS total_count
    FROM world_feature_hex_cells AS wfhc
    JOIN world_features AS wf ON wf.gers_id = wfhc.gers_id
    JOIN feature_state AS fs ON fs.gers_id = wf.gers_id
    WHERE wf.feature_type = 'road'
    GROUP BY wfhc.h3_index
    `
  );

  const roadStats = new Map<string, RoadStats>();
  for (const row of roadStatsResult.rows) {
    roadStats.set(row.h3_index, {
      healthy: Number(row.healthy_count ?? 0),
      total: Number(row.total_count ?? 0)
    });
  }

  const baseSpread = Number(process.env.RUST_SPREAD_BASE ?? DEFAULT_BASE_SPREAD);
  const updates = computeRustUpdates({
    cells,
    roadStats,
    multipliers,
    baseSpread,
    getNeighbors: getNeighborIndexes
  });

  if (updates.length === 0) {
    return [];
  }

  const indices = updates.map((update) => update.h3_index);
  const rustLevels = updates.map((update) => update.rust_level);

  await pool.query(
    `
    UPDATE hex_cells AS h
    SET rust_level = data.rust_level,
        updated_at = now()
    FROM (
      SELECT
        UNNEST($1::text[]) AS h3_index,
        UNNEST($2::float8[]) AS rust_level
    ) AS data
    WHERE h.h3_index = data.h3_index
      AND h.rust_level IS DISTINCT FROM data.rust_level
    `,
    [indices, rustLevels]
  );

  return updates;
}
