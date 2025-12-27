import { spawn } from "child_process";
import { Pool, type PoolClient } from "pg";
import { cellToBoundary, cellToLatLng, latLngToCell, polygonToCells } from "h3-js";
import * as dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { 
  ROAD_CLASS_FILTER, 
  REGION_CONFIGS, 
  H3_RESOLUTION, 
  type Bbox, 
  type RegionConfig 
} from "@nightfall/config";

export { ROAD_CLASS_FILTER, REGION_CONFIGS, H3_RESOLUTION };

/**
 * Interpolate a point along a LineString at position t (0-1).
 * Used to find connector positions along road segments.
 */
export function interpolateLineString(coords: number[][], t: number): [number, number] {
  if (coords.length === 0) return [0, 0];
  if (coords.length === 1) return coords[0] as [number, number];
  if (t <= 0) return coords[0] as [number, number];
  if (t >= 1) return coords[coords.length - 1] as [number, number];

  // Calculate total length and segment lengths
  let totalLength = 0;
  const segmentLengths: number[] = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const dx = coords[i + 1][0] - coords[i][0];
    const dy = coords[i + 1][1] - coords[i][1];
    const len = Math.sqrt(dx * dx + dy * dy);
    segmentLengths.push(len);
    totalLength += len;
  }

  // Find target distance
  const targetDist = t * totalLength;
  let accum = 0;

  for (let i = 0; i < segmentLengths.length; i++) {
    if (accum + segmentLengths[i] >= targetDist) {
      // Interpolate within this segment
      const segProgress = (targetDist - accum) / segmentLengths[i];
      const lng = coords[i][0] + (coords[i + 1][0] - coords[i][0]) * segProgress;
      const lat = coords[i][1] + (coords[i + 1][1] - coords[i][1]) * segProgress;
      return [lng, lat];
    }
    accum += segmentLengths[i];
  }

  return coords[coords.length - 1] as [number, number];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

type OvertureDataset = {
  type: string;
  theme?: string;
};

const OVERTURE_DATASETS: OvertureDataset[] = [
  { type: "segment", theme: "transportation" },
  { type: "building", theme: "buildings" },
  { type: "place", theme: "places" },
  { type: "land", theme: "base" }
];
const DUCKDB_BIN = path.resolve(__dirname, "../bin/duckdb");

const DB_CONFIG = {
  connectionString: process.env.DATABASE_URL || "postgresql://nightfall:nightfall@localhost:5432/nightfall?sslmode=disable",
};

const DEFAULT_REGION_ID = "boston_ma_usa";

// Resource generation categories matching API server
const FOOD_CATEGORY_PATTERNS = [
  "restaurant",
  "cafe",
  "bar",
  "food",
  "grocery",
  "supermarket",
  "bakery",
  "deli",
  "farm",
  "farmers_market"
];

const EQUIPMENT_CATEGORY_PATTERNS = [
  "hardware",
  "home_improvement",
  "automotive_repair",
  "auto_body_shop",
  "tool_rental",
  "machine_shop"
];

const ENERGY_CATEGORY_PATTERNS = [
  "industrial",
  "factory",
  "power_plant",
  "solar",
  "wind",
  "utility",
  "electric"
];

const MATERIALS_CATEGORY_PATTERNS = [
  "construction",
  "building_supply",
  "lumber",
  "wood",
  "flooring",
  "warehouse",
  "manufacturing",
  "garden_center",
  "nursery_and_gardening"
];

// Fallback applies to 1 in N buildings without matched categories
// Lower = more aggressive fallback (more balanced resource distribution)
const FALLBACK_RESOURCE_MOD = 2;
const MAX_BUILDINGS_PER_HEX_PER_TYPE = 10;

export function normalizeCategories(raw: unknown) {
  if (!raw) {
    return null;
  }
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// Tracking for balanced fallback distribution
const fallbackTracker = {
  food: 0,
  equipment: 0,
  energy: 0,
  materials: 0,
  reset() {
    this.food = 0;
    this.equipment = 0;
    this.energy = 0;
    this.materials = 0;
  }
};

export function applyResourceFallback(
  gersId: string,
  resources: { food: boolean; equipment: boolean; energy: boolean; materials: boolean; cat: string | null }
) {
  if (resources.food || resources.equipment || resources.energy || resources.materials) {
    // Track matched resources for balance calculation
    if (resources.food) fallbackTracker.food++;
    if (resources.equipment) fallbackTracker.equipment++;
    if (resources.energy) fallbackTracker.energy++;
    if (resources.materials) fallbackTracker.materials++;
    return resources;
  }

  const hash = hashString(gersId);
  if (hash % FALLBACK_RESOURCE_MOD !== 0) {
    return resources;
  }

  // Find the least represented resource type and assign it
  // This helps balance the distribution
  const counts = [
    { type: "food" as const, count: fallbackTracker.food },
    { type: "equipment" as const, count: fallbackTracker.equipment },
    { type: "energy" as const, count: fallbackTracker.energy },
    { type: "materials" as const, count: fallbackTracker.materials }
  ];

  // Sort by count ascending - pick from least represented
  counts.sort((a, b) => a.count - b.count);

  // Use hash to deterministically pick from the 2 least represented types
  const targetType = counts[hash % 2].type;

  // Update tracker
  fallbackTracker[targetType]++;

  return {
    ...resources,
    food: targetType === "food",
    equipment: targetType === "equipment",
    energy: targetType === "energy",
    materials: targetType === "materials"
  };
}

export function resetFallbackTracker() {
  fallbackTracker.reset();
}

function collectCategoryStrings(categories: unknown): string[] {
  if (!categories) {
    return [];
  }

  const entries = Array.isArray(categories) ? categories : [categories];
  const results: string[] = [];

  for (const entry of entries) {
    if (!entry) {
      continue;
    }
    if (typeof entry === "string") {
      results.push(entry);
      continue;
    }
    if (typeof entry.primary === "string") {
      results.push(entry.primary);
    }
    if (typeof entry.main?.primary === "string") {
      results.push(entry.main.primary);
    }
    if (Array.isArray(entry.alternate)) {
      for (const alt of entry.alternate) {
        if (typeof alt === "string") {
          results.push(alt);
        }
      }
    }
  }

  return results;
}

export function calculateBuildingWeight(
  gersId: string,
  area: number,
  hasMatchedCategory: boolean
): number {
  // Weight formula: prioritize matched categories, then larger footprints
  // Matched category: +1000 base weight
  // Area contributes directly (larger = higher weight)
  // Hash provides deterministic tiebreaker
  const baseWeight = hasMatchedCategory ? 1000 : 0;
  const areaWeight = Math.min(area * 10000, 500); // Cap area contribution
  const hashTiebreaker = (hashString(gersId) % 100) / 100; // 0-1 range
  return baseWeight + areaWeight + hashTiebreaker;
}

type BuildingWithWeight = {
  id: string;
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  categories: unknown;
  resources: { food: boolean; equipment: boolean; energy: boolean; materials: boolean; cat: string | null };
  weight: number;
  area: number;
  cells: string[];
};

export function limitBuildingsPerHex(
  buildings: BuildingWithWeight[],
  maxPerType: number
): BuildingWithWeight[] {
  // Track counts per hex per resource type
  const hexResourceCounts: Map<string, { food: number; equipment: number; energy: number; materials: number }> = new Map();

  // Sort by weight descending (highest priority first)
  const sortedBuildings = [...buildings].sort((a, b) => b.weight - a.weight);

  const selectedBuildings: BuildingWithWeight[] = [];

  for (const building of sortedBuildings) {
    const resourceType = building.resources.food ? "food" :
                         building.resources.equipment ? "equipment" :
                         building.resources.energy ? "energy" :
                         building.resources.materials ? "materials" : null;

    if (!resourceType) {
      // Building generates no resources, skip limit
      selectedBuildings.push(building);
      continue;
    }

    // Check if ALL cells have room for this building (strict per-hex limit)
    let canAdd = true;
    for (const cell of building.cells) {
      if (!hexResourceCounts.has(cell)) {
        hexResourceCounts.set(cell, { food: 0, equipment: 0, energy: 0, materials: 0 });
      }
      const counts = hexResourceCounts.get(cell)!;

      if (counts[resourceType] >= maxPerType) {
        canAdd = false;
        break;
      }
    }

    if (canAdd) {
      selectedBuildings.push(building);
      // Update counts for all cells this building touches
      for (const cell of building.cells) {
        const counts = hexResourceCounts.get(cell)!;
        counts[resourceType]++;
      }
    }
  }

  return selectedBuildings;
}

export function getResourcesFromCategories(categories: unknown) {
  const values = collectCategoryStrings(categories);
  if (values.length === 0) {
    return { food: false, equipment: false, energy: false, materials: false, cat: null };
  }

  let food = false;
  let equipment = false;
  let energy = false;
  let materials = false;
  let matchedCategory: string | null = null;

  for (const value of values) {
    const lower = value.toLowerCase();
    const foodMatch = FOOD_CATEGORY_PATTERNS.some((pattern) => lower.includes(pattern));
    const equipmentMatch = EQUIPMENT_CATEGORY_PATTERNS.some((pattern) => lower.includes(pattern));
    const energyMatch = ENERGY_CATEGORY_PATTERNS.some((pattern) => lower.includes(pattern));
    const materialsMatch = MATERIALS_CATEGORY_PATTERNS.some((pattern) => lower.includes(pattern));

    if ((foodMatch || equipmentMatch || energyMatch || materialsMatch) && matchedCategory === null) {
      matchedCategory = value;
    }
    if (foodMatch) food = true;
    if (equipmentMatch) equipment = true;
    if (energyMatch) energy = true;
    if (materialsMatch) materials = true;
  }

  return { food, equipment, energy, materials, cat: matchedCategory ?? values[0] ?? null };
}

export function buildBuildingsUpsertQuery(placeHolders: string[]) {
  return `
        INSERT INTO world_features (
          gers_id,
          feature_type,
          region_id,
          bbox_xmin,
          bbox_ymin,
          bbox_xmax,
          bbox_ymax,
          properties,
          road_class,
          place_category,
          generates_food,
          generates_equipment,
          generates_energy,
          generates_materials
        ) VALUES ${placeHolders.join(", ")}
        ON CONFLICT (gers_id) DO UPDATE SET
          region_id = EXCLUDED.region_id,
          bbox_xmin = EXCLUDED.bbox_xmin,
          bbox_ymin = EXCLUDED.bbox_ymin,
          bbox_xmax = EXCLUDED.bbox_xmax,
          bbox_ymax = EXCLUDED.bbox_ymax,
          properties = EXCLUDED.properties,
          road_class = EXCLUDED.road_class,
          place_category = EXCLUDED.place_category,
          generates_food = EXCLUDED.generates_food,
          generates_equipment = EXCLUDED.generates_equipment,
          generates_energy = EXCLUDED.generates_energy,
          generates_materials = EXCLUDED.generates_materials
      `;
}

export function buildBuildingsQuery() {
  return `
    SELECT 
      b.id, 
      b.bbox.xmin as xmin,
      b.bbox.ymin as ymin,
      b.bbox.xmax as xmax,
      b.bbox.ymax as ymax,
      to_json(list(p.categories)) as categories
    FROM buildings_raw b
    LEFT JOIN places_raw p ON ST_Intersects(b.geometry, p.geometry)
    GROUP BY 
      b.id, 
      b.bbox.xmin, 
      b.bbox.ymin, 
      b.bbox.xmax, 
      b.bbox.ymax
  `;
}

export function getRegionConfig() {
  const argRegion = process.argv.find((arg) => arg.startsWith("--region="));
  const regionKey = argRegion?.split("=")[1] || process.env.INGEST_REGION || DEFAULT_REGION_ID;
  const region = REGION_CONFIGS[regionKey];

  if (!region) {
    const available = Object.keys(REGION_CONFIGS).sort().join(", ");
    throw new Error(`Unknown region "${regionKey}". Available regions: ${available}`);
  }

  return region;
}

function getOvertureDataDir(region: RegionConfig) {
  return (
    process.env.OVERTURE_DATA_DIR || path.resolve(__dirname, "../data/overture", region.regionId)
  );
}

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

export function shouldSeedDemo() {
  return hasFlag("--seed-demo") || hasFlag("--demo");
}

function getDatasetCandidates(dataDir: string, dataset: OvertureDataset) {
  const candidates: string[] = [];
  const { theme, type } = dataset;

  if (theme) {
    candidates.push(path.resolve(dataDir, `theme=${theme}`, `type=${type}`));
    candidates.push(path.resolve(dataDir, theme, type));
  }

  candidates.push(path.resolve(dataDir, `${type}.parquet`));
  candidates.push(path.resolve(dataDir, `type=${type}.parquet`));
  candidates.push(path.resolve(dataDir, `type=${type}`));
  candidates.push(path.resolve(dataDir, type));

  return candidates;
}

function datasetExists(dataDir: string, dataset: OvertureDataset) {
  return getDatasetCandidates(dataDir, dataset).some((candidate) => fs.existsSync(candidate));
}

export function buildRoadsQuery(roadsPath: string, region: RegionConfig) {
  const classFilter = ROAD_CLASS_FILTER.map((roadClass) => `'${roadClass}'`).join(", ");
  return `
      CREATE OR REPLACE TABLE roads_raw AS 
      SELECT 
        id,
        bbox,
        subtype,
        class
      FROM read_parquet('${roadsPath}')
      WHERE 
        bbox.xmin > ${region.bbox.xmin} AND 
        bbox.xmax < ${region.bbox.xmax} AND 
        bbox.ymin > ${region.bbox.ymin} AND 
        bbox.ymax < ${region.bbox.ymax} AND
        subtype = 'road' AND
        class IN (${classFilter})
    `;
}

async function runOvertureDownload(region: RegionConfig, options?: { clean?: boolean }) {
  const dataDir = getOvertureDataDir(region);
  const clean = Boolean(options?.clean);

  if (clean) {
    await fs.promises.rm(dataDir, { recursive: true, force: true });
  }

  await fs.promises.mkdir(dataDir, { recursive: true });

  if (!clean) {
    const allPresent = OVERTURE_DATASETS.every((dataset) => datasetExists(dataDir, dataset));
    if (allPresent) {
      console.log("Overture: Using cached data.");
      return dataDir;
    }
  }

  const bboxArg = `${region.bbox.xmin},${region.bbox.ymin},${region.bbox.xmax},${region.bbox.ymax}`;
  console.log("Overture: Downloading latest data...");

  for (const dataset of OVERTURE_DATASETS) {
    const outputPath = path.resolve(dataDir, `${dataset.type}.parquet`);
    const args = [
      "download",
      `--bbox=${bboxArg}`,
      "-o",
      outputPath,
      "-f",
      "geoparquet",
      `--type=${dataset.type}`
    ];

    await new Promise<void>((resolve, reject) => {
      const child = spawn("overturemaps", args, { stdio: "inherit" });

      child.on("error", (error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new Error("overturemaps binary not found. Install with: pip install overturemaps-py"));
          return;
        }
        reject(error);
      });

      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`overturemaps exited with code ${code}`));
          return;
        }
        resolve();
      });
    });
  }

  return dataDir;
}

function resolveOverturePath(dataDir: string, dataset: OvertureDataset) {
  const candidates = getDatasetCandidates(dataDir, dataset);

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    const stat = fs.statSync(candidate);
    if (stat.isDirectory()) {
      return path.join(candidate, "*");
    }
    if (stat.isFile()) {
      return candidate;
    }
  }

  const hint = dataset.theme ? `${dataset.theme}/${dataset.type}` : dataset.type;
  throw new Error(`Overture data not found for ${hint} in ${dataDir}`);
}

function bboxToCells(bbox: Bbox, resolution: number) {
  const ring = [
    [bbox.ymin, bbox.xmin],
    [bbox.ymin, bbox.xmax],
    [bbox.ymax, bbox.xmax],
    [bbox.ymax, bbox.xmin],
    [bbox.ymin, bbox.xmin]
  ];

  try {
    const cells = polygonToCells([ring], resolution);
    if (cells.length > 0) {
      return cells;
    }
  } catch {
    // Fall through to centroid-based fallback.
  }

  const lat = (bbox.ymin + bbox.ymax) / 2;
  const lon = (bbox.xmin + bbox.xmax) / 2;
  return [latLngToCell(lat, lon, resolution)];
}

function buildHexWkt(h3Index: string) {
  const boundary = cellToBoundary(h3Index);
  const coords = boundary.map((point) => {
    if (Array.isArray(point)) {
      const [lat, lon] = point;
      return [lat, lon];
    }
    return [point.lat, point.lng];
  });

  if (coords.length === 0) {
    return null;
  }

  const ring = [...coords, coords[0]];
  const wkt = ring.map(([lat, lon]) => `${lon} ${lat}`).join(", ");
  return `POLYGON((${wkt}))`;
}

async function computeLandRatios(
  dataDir: string,
  region: RegionConfig,
  hexes: string[]
) {
  if (hexes.length === 0) {
    return [];
  }

  const landPath = resolveOverturePath(dataDir, { theme: "base", type: "land" });
  const results: Array<{ h3_index: string; land_ratio: number }> = [];
  const CHUNK_SIZE = 300;

  for (let i = 0; i < hexes.length; i += CHUNK_SIZE) {
    const chunk = hexes.slice(i, i + CHUNK_SIZE);
    const values = chunk
      .map((h3Index) => {
        const wkt = buildHexWkt(h3Index);
        if (!wkt) {
          return null;
        }
        return `('${h3Index}', ST_GeomFromText('${wkt}'))`;
      })
      .filter(Boolean)
      .join(", ");

    if (!values) {
      continue;
    }

    const rows = await runDuckDB(`
      WITH hexes(h3_index, geom) AS (
        VALUES ${values}
      ),
      hexes_with_area AS (
        SELECT
          h3_index,
          geom,
          ST_Area(geom) AS hex_area
        FROM hexes
      ),
      land AS (
        SELECT geometry
        FROM read_parquet('${landPath}')
        WHERE
          bbox.xmin > ${region.bbox.xmin} AND
          bbox.xmax < ${region.bbox.xmax} AND
          bbox.ymin > ${region.bbox.ymin} AND
          bbox.ymax < ${region.bbox.ymax}
      )
      SELECT
        h.h3_index,
        SUM(ST_Area(ST_Intersection(l.geometry, h.geom))) / NULLIF(h.hex_area, 0) AS land_ratio
      FROM hexes_with_area h
      JOIN land l ON ST_Intersects(l.geometry, h.geom)
      GROUP BY h.h3_index, h.hex_area
    `);

    rows.forEach((row) => {
      const ratio = Math.min(1, Math.max(0, Number(row.land_ratio ?? 0)));
      results.push({ h3_index: row.h3_index, land_ratio: ratio });
    });
  }

  return results;
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function insertHexCells(
  client: PoolClient,
  h3Indices: string[],
  regionId: string,
  centerLat: number,
  centerLon: number
) {
  if (h3Indices.length === 0) {
    return;
  }

  const values: Array<string | number> = [];
  const placeholders: string[] = [];

  h3Indices.forEach((h3Index, idx) => {
    const [lat, lon] = cellToLatLng(h3Index);
    const dist = haversine(lat, lon, centerLat, centerLon);
    const offset = idx * 3;

    placeholders.push(`($${offset + 1}, $${offset + 2}, 0, $${offset + 3})`);
    values.push(h3Index, regionId, dist);
  });

  await client.query(
    `
    INSERT INTO hex_cells (h3_index, region_id, rust_level, distance_from_center)
    VALUES ${placeholders.join(", ")}
    ON CONFLICT (h3_index) DO NOTHING
    `,
    values
  );
}

async function insertWorldFeatureHexCells(
  client: PoolClient,
  mappings: Array<[string, string]>
) {
  if (mappings.length === 0) {
    return;
  }

  const values: Array<string> = [];
  const placeholders: string[] = [];

  mappings.forEach(([gersId, h3Index], idx) => {
    const offset = idx * 2;
    placeholders.push(`($${offset + 1}, $${offset + 2})`);
    values.push(gersId, h3Index);
  });

  await client.query(
    `
    INSERT INTO world_feature_hex_cells (gers_id, h3_index)
    VALUES ${placeholders.join(", ")}
    ON CONFLICT (gers_id, h3_index) DO NOTHING
    `,
    values
  );
}

async function pruneHexCells(
  client: PoolClient,
  regionId: string,
  keepHexes: Set<string>
) {
  const existing = await client.query<{ h3_index: string }>(
    "SELECT h3_index FROM hex_cells WHERE region_id = $1",
    [regionId]
  );

  if (existing.rows.length === 0) {
    return;
  }

  const toDelete =
    keepHexes.size === 0
      ? existing.rows.map((row) => row.h3_index)
      : existing.rows
          .map((row) => row.h3_index)
          .filter((h3) => !keepHexes.has(h3));

  if (toDelete.length === 0) {
    return;
  }

  await client.query(
    "DELETE FROM world_feature_hex_cells WHERE h3_index = ANY($1::text[])",
    [toDelete]
  );

  await client.query(
    "DELETE FROM hex_cells WHERE region_id = $1 AND h3_index = ANY($2::text[])",
    [regionId, toDelete]
  );
}

async function updateLandRatios(
  pgPool: Pool,
  region: RegionConfig,
  dataDir: string,
  regionHexes: Set<string>
) {
  const hexList = Array.from(regionHexes);
  if (hexList.length === 0) {
    return;
  }

  const ratios = await computeLandRatios(dataDir, region, hexList);
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE hex_cells SET land_ratio = 0 WHERE region_id = $1", [
      region.regionId
    ]);

    if (ratios.length > 0) {
      const indices = ratios.map((row) => row.h3_index);
      const values = ratios.map((row) => row.land_ratio);
      await client.query(
        `
        UPDATE hex_cells AS h
        SET land_ratio = data.land_ratio
        FROM (
          SELECT
            UNNEST($1::text[]) AS h3_index,
            UNNEST($2::float8[]) AS land_ratio
        ) AS data
        WHERE h.region_id = $3
          AND h.h3_index = data.h3_index
        `,
        [indices, values, region.regionId]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function assignHubBuildings(pgPool: Pool, region: RegionConfig) {
  console.log("--- Assigning Hub Buildings ---");
  const client = await pgPool.connect();

  try {
    await client.query("BEGIN");

    // Reset existing hub assignments for this region
    await client.query(`
      UPDATE world_features
      SET is_hub = FALSE
      WHERE region_id = $1 AND is_hub = TRUE
    `, [region.regionId]);

    await client.query(`
      UPDATE hex_cells
      SET hub_building_gers_id = NULL
      WHERE region_id = $1
    `, [region.regionId]);

    // Get all hexes in the region
    const hexResult = await client.query<{ h3_index: string }>(
      "SELECT h3_index FROM hex_cells WHERE region_id = $1",
      [region.regionId]
    );

    if (hexResult.rows.length === 0) {
      console.log("No hexes found for region");
      await client.query("COMMIT");
      return;
    }

    // Get all building-to-hex mappings for this region with footprint area proxy
    const buildingResult = await client.query<{
      h3_index: string;
      gers_id: string;
      area: number;
    }>(`
      SELECT
        wfh.h3_index,
        wf.gers_id,
        (wf.bbox_xmax - wf.bbox_xmin) * (wf.bbox_ymax - wf.bbox_ymin) AS area
      FROM world_features wf
      JOIN world_feature_hex_cells wfh ON wf.gers_id = wfh.gers_id
      WHERE wf.feature_type = 'building'
        AND wf.region_id = $1
    `, [region.regionId]);

    console.log(`Found ${buildingResult.rows.length} building-to-hex mappings for ${hexResult.rows.length} hexes`);

    // Group buildings by hex
    const buildingsByHex: Map<string, Array<{ gers_id: string; area: number }>> = new Map();
    for (const row of buildingResult.rows) {
      if (!buildingsByHex.has(row.h3_index)) {
        buildingsByHex.set(row.h3_index, []);
      }
      buildingsByHex.get(row.h3_index)!.push({
        gers_id: row.gers_id,
        area: row.area
      });
    }

    console.log(`Grouped buildings into ${buildingsByHex.size} hexes with buildings`);

    // Find the building with the largest footprint in each hex
    const hubAssignments: Array<{ h3_index: string; building_gers_id: string }> = [];

    for (const [h3Index, buildings] of buildingsByHex.entries()) {
      if (!buildings || buildings.length === 0) continue;

      let largestBuilding = buildings[0];
      for (let i = 1; i < buildings.length; i++) {
        if (buildings[i].area > largestBuilding.area) {
          largestBuilding = buildings[i];
        }
      }

      hubAssignments.push({ h3_index: h3Index, building_gers_id: largestBuilding.gers_id });
    }

    console.log(`Found ${hubAssignments.length} hub building assignments`);

    if (hubAssignments.length > 0) {
      // Update hex_cells with hub building
      const hexIndices = hubAssignments.map(r => r.h3_index);
      const buildingIds = hubAssignments.map(r => r.building_gers_id);

      await client.query(`
        UPDATE hex_cells h
        SET hub_building_gers_id = data.building_gers_id
        FROM (
          SELECT
            UNNEST($1::text[]) AS h3_index,
            UNNEST($2::text[]) AS building_gers_id
        ) AS data
        WHERE h.h3_index = data.h3_index
          AND h.region_id = $3
      `, [hexIndices, buildingIds, region.regionId]);

      // Mark buildings as hubs (deduplicated)
      const uniqueHubIds = [...new Set(buildingIds)];
      await client.query(`
        UPDATE world_features
        SET is_hub = TRUE
        WHERE gers_id = ANY($1::text[])
      `, [uniqueHubIds]);

      console.log(`Assigned ${uniqueHubIds.length} unique hub buildings across ${hubAssignments.length} hexes`);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function ingestRoadGraph(
  pgPool: Pool,
  region: RegionConfig,
  dataDir: string
) {
  console.log("--- Starting Road Graph Ingest ---");

  const segmentsPath = resolveOverturePath(dataDir, { theme: "transportation", type: "segment" });
  const classFilter = ROAD_CLASS_FILTER.map((roadClass) => `'${roadClass}'`).join(", ");

  // Query segments with full geometry coordinates for interpolation
  // Use TO_JSON to properly serialize the connectors array
  const segmentsWithConnectors = await runDuckDB(`
    SELECT
      id,
      class,
      TO_JSON(connectors) as connectors_json,
      ST_AsGeoJSON(geometry) as geometry_json
    FROM read_parquet('${segmentsPath}')
    WHERE
      bbox.xmin > ${region.bbox.xmin} AND
      bbox.xmax < ${region.bbox.xmax} AND
      bbox.ymin > ${region.bbox.ymin} AND
      bbox.ymax < ${region.bbox.ymax} AND
      subtype = 'road' AND
      class IN (${classFilter})
  `);

  console.log(`Found ${segmentsWithConnectors.length} segments with connectors`);

  // Extract unique connectors with their positions
  const connectorMap = new Map<string, { lng: number; lat: number }>();

  for (const segment of segmentsWithConnectors) {
    // connectors_json is already parsed by DuckDB's JSON output
    const connectors = segment.connectors_json;
    if (!Array.isArray(connectors) || connectors.length === 0) continue;

    // geometry_json is already parsed by DuckDB's JSON output
    const geom = segment.geometry_json;
    if (!geom || geom.type !== "LineString" || !Array.isArray(geom.coordinates)) continue;
    const coords: number[][] = geom.coordinates;
    if (coords.length === 0) continue;

    for (const conn of connectors) {
      if (!conn.connector_id) continue;

      // Interpolate position along the line using `at` value
      const at = conn.at ?? 0;
      const [lng, lat] = interpolateLineString(coords, at);

      // Only store if we don't have it yet (first occurrence wins)
      if (!connectorMap.has(conn.connector_id)) {
        connectorMap.set(conn.connector_id, { lng, lat });
      }
    }
  }

  console.log(`Extracted ${connectorMap.size} unique connectors`);

  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");

    // Clear existing road graph for this region
    await client.query(
      "DELETE FROM road_edges WHERE segment_gers_id IN (SELECT gers_id FROM world_features WHERE region_id = $1 AND feature_type = 'road')",
      [region.regionId]
    );
    await client.query("DELETE FROM road_connectors WHERE region_id = $1", [region.regionId]);

    // Insert connectors in batches
    const connectorEntries = Array.from(connectorMap.entries());
    const CHUNK_SIZE = 1000;

    for (let i = 0; i < connectorEntries.length; i += CHUNK_SIZE) {
      const chunk = connectorEntries.slice(i, i + CHUNK_SIZE);
      const values: (string | number)[] = [];
      const placeholders: string[] = [];

      chunk.forEach(([connectorId, { lng, lat }], idx) => {
        const offset = idx * 5;
        const h3Index = latLngToCell(lat, lng, H3_RESOLUTION);
        placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`);
        values.push(connectorId, lng, lat, h3Index, region.regionId);
      });

      await client.query(
        `INSERT INTO road_connectors (connector_id, lng, lat, h3_index, region_id)
         VALUES ${placeholders.join(", ")}
         ON CONFLICT (connector_id) DO NOTHING`,
        values
      );
      process.stdout.write(".");
    }

    console.log(`\nInserted ${connectorMap.size} connectors`);

    // Insert edges
    let edgeCount = 0;
    const edgeBatch: Array<{
      segmentId: string;
      fromConnector: string;
      toConnector: string;
      lengthMeters: number;
      h3Index: string;
    }> = [];

    for (const segment of segmentsWithConnectors) {
      const connectors = segment.connectors_json;
      if (!Array.isArray(connectors)) continue;

      // Sort connectors by `at` value to get from -> to order
      const sortedConnectors = [...connectors]
        .filter((c: any) => c.connector_id)
        .sort((a: any, b: any) => (a.at ?? 0) - (b.at ?? 0));

      if (sortedConnectors.length < 2) continue;

      const fromConnector = sortedConnectors[0].connector_id;
      const toConnector = sortedConnectors[sortedConnectors.length - 1].connector_id;

      // Calculate length in meters using haversine
      const fromCoord = connectorMap.get(fromConnector);
      const toCoord = connectorMap.get(toConnector);
      if (!fromCoord || !toCoord) continue;

      const lengthMeters = haversine(fromCoord.lat, fromCoord.lng, toCoord.lat, toCoord.lng);
      const h3Index = latLngToCell(
        (fromCoord.lat + toCoord.lat) / 2,
        (fromCoord.lng + toCoord.lng) / 2,
        H3_RESOLUTION
      );

      // Add both directions (bidirectional graph)
      edgeBatch.push({
        segmentId: segment.id,
        fromConnector,
        toConnector,
        lengthMeters,
        h3Index
      });
      edgeBatch.push({
        segmentId: segment.id,
        fromConnector: toConnector,
        toConnector: fromConnector,
        lengthMeters,
        h3Index
      });
    }

    // Insert edges in batches
    for (let i = 0; i < edgeBatch.length; i += CHUNK_SIZE) {
      const chunk = edgeBatch.slice(i, i + CHUNK_SIZE);
      const values: (string | number)[] = [];
      const placeholders: string[] = [];

      chunk.forEach((edge, idx) => {
        const offset = idx * 5;
        placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`);
        values.push(edge.segmentId, edge.fromConnector, edge.toConnector, edge.lengthMeters, edge.h3Index);
      });

      await client.query(
        `INSERT INTO road_edges (segment_gers_id, from_connector, to_connector, length_meters, h3_index)
         VALUES ${placeholders.join(", ")}
         ON CONFLICT (segment_gers_id, from_connector, to_connector) DO NOTHING`,
        values
      );
      edgeCount += chunk.length;
      process.stdout.write(".");
    }

    await client.query("COMMIT");
    console.log(`\nSuccess! Inserted ${edgeCount} edges (${edgeBatch.length / 2} segments × 2 directions)`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function seedDemoData(pgPool: Pool, region: RegionConfig) {
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");

    const crewsResult = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text as count FROM crews WHERE region_id = $1",
      [region.regionId]
    );
    const crewsCount = Number(crewsResult.rows[0]?.count ?? 0);

    if (crewsCount === 0) {
      await client.query(
        `
        INSERT INTO crews (region_id, status)
        SELECT $1, 'idle'
        FROM generate_series(1, 2)
        `,
        [region.regionId]
      );
    }

    const tasksResult = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text as count FROM tasks WHERE region_id = $1",
      [region.regionId]
    );
    const tasksCount = Number(tasksResult.rows[0]?.count ?? 0);

    if (tasksCount === 0) {
      const targetsResult = await client.query<{ gers_id: string }>(
        `
        SELECT gers_id
        FROM world_features
        WHERE region_id = $1
          AND feature_type = 'road'
        ORDER BY gers_id
        LIMIT 3
        `,
        [region.regionId]
      );
      const targetIds = targetsResult.rows.map((row) => row.gers_id);

      if (targetIds.length > 0) {
        await client.query(
          `
          UPDATE feature_state
          SET health = LEAST(health, 25),
              status = 'degraded',
              updated_at = now()
          WHERE gers_id = ANY($1::text[])
          `,
          [targetIds]
        );

        await client.query(
          `
          INSERT INTO tasks (
            region_id,
            target_gers_id,
            task_type,
            cost_food,
            cost_equipment,
            cost_energy,
            cost_materials,
            duration_s,
            repair_amount,
            priority_score,
            vote_score,
            status
          )
          SELECT
            wf.region_id,
            wf.gers_id,
            'repair_road',
            CASE wf.road_class
              WHEN 'motorway' THEN 40
              WHEN 'trunk' THEN 35
              WHEN 'primary' THEN 25
              WHEN 'secondary' THEN 20
              WHEN 'tertiary' THEN 15
              WHEN 'residential' THEN 10
              ELSE 10
            END AS cost_food,
            CASE wf.road_class
              WHEN 'motorway' THEN 80
              WHEN 'trunk' THEN 60
              WHEN 'primary' THEN 45
              WHEN 'secondary' THEN 30
              WHEN 'tertiary' THEN 25
              WHEN 'residential' THEN 15
              ELSE 15
            END AS cost_equipment,
            CASE wf.road_class
              WHEN 'motorway' THEN 60
              WHEN 'trunk' THEN 50
              WHEN 'primary' THEN 35
              WHEN 'secondary' THEN 25
              WHEN 'tertiary' THEN 20
              WHEN 'residential' THEN 12
              ELSE 12
            END AS cost_energy,
            CASE wf.road_class
              WHEN 'motorway' THEN 100
              WHEN 'trunk' THEN 80
              WHEN 'primary' THEN 60
              WHEN 'secondary' THEN 40
              WHEN 'tertiary' THEN 30
              WHEN 'residential' THEN 20
              ELSE 20
            END AS cost_materials,
            CASE wf.road_class
              WHEN 'motorway' THEN 120
              WHEN 'trunk' THEN 100
              WHEN 'primary' THEN 80
              WHEN 'secondary' THEN 60
              WHEN 'tertiary' THEN 50
              WHEN 'residential' THEN 40
              ELSE 40
            END AS duration_s,
            CASE wf.road_class
              WHEN 'motorway' THEN 30
              WHEN 'trunk' THEN 30
              WHEN 'primary' THEN 25
              WHEN 'secondary' THEN 25
              WHEN 'tertiary' THEN 20
              WHEN 'residential' THEN 20
              ELSE 20
            END AS repair_amount,
            0,
            0,
            'queued'
          FROM world_features AS wf
          WHERE wf.gers_id = ANY($1::text[])
            AND NOT EXISTS (
              SELECT 1
              FROM tasks AS t
              WHERE t.target_gers_id = wf.gers_id
                AND t.status IN ('queued', 'active')
            )
          `,
          [targetIds]
        );
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function runDuckDB(query: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const dbPath = path.resolve(__dirname, "../ingest.duckdb");
    
    // Commands to setup environment
    const setup = `
      INSTALL spatial;
      LOAD spatial;
    `;
    
    const fullQuery = `${setup} ${query}`;
    
    console.log(`DuckDB: Executing query...`);
    
    const child = spawn(DUCKDB_BIN, [dbPath, "-json", "-c", fullQuery]);
    
    let stdout = "";
    let stderr = "";
    
    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    
    child.on("close", (code) => {
      if (code !== 0) {
        console.error("DuckDB stderr:", stderr);
        reject(new Error(`DuckDB exited with code ${code}`));
        return;
      }
      
      try {
        if (!stdout.trim()) {
          resolve([]);
          return;
        }
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (e) {
        console.error("Failed to parse DuckDB output:", stdout);
        reject(e);
      }
    });
  });
}

async function ingestBuildings(
  pgPool: Pool,
  region: RegionConfig,
  centerLat: number,
  centerLon: number,
  dataDir: string,
  regionHexes: Set<string>
) {
  console.log("--- Starting Building Ingest ---");

  const buildingsPath = resolveOverturePath(dataDir, { theme: "buildings", type: "building" });
  const placesPath = resolveOverturePath(dataDir, { theme: "places", type: "place" });
  
  // 1. Get Buildings
  await runDuckDB(`
    CREATE OR REPLACE TABLE buildings_raw AS 
    SELECT 
      id,
      geometry,
      bbox
    FROM read_parquet('${buildingsPath}')
    WHERE 
      bbox.xmin > ${region.bbox.xmin} AND 
      bbox.xmax < ${region.bbox.xmax} AND 
      bbox.ymin > ${region.bbox.ymin} AND 
      bbox.ymax < ${region.bbox.ymax}
  `);

  // 2. Get Places (for joining)
  await runDuckDB(`
    CREATE OR REPLACE TABLE places_raw AS 
    SELECT 
      id, 
      geometry, 
      categories
    FROM read_parquet('${placesPath}')
    WHERE 
      bbox.xmin > ${region.bbox.xmin} AND 
      bbox.xmax < ${region.bbox.xmax} AND 
      bbox.ymin > ${region.bbox.ymin} AND 
      bbox.ymax < ${region.bbox.ymax}
  `);

  const placeCount = await runDuckDB("SELECT COUNT(*) as count FROM places_raw");
  console.log(`Loaded ${placeCount[0].count} places.`);

  // 3. Join
  const rawBuildings = await runDuckDB(buildBuildingsQuery());

  // Pre-process buildings with weights and cells
  const processedBuildings: BuildingWithWeight[] = rawBuildings.map((b: any) => {
    const categories = normalizeCategories(b.categories);
    const baseResources = getResourcesFromCategories(categories);
    const resources = applyResourceFallback(b.id, baseResources);
    const bbox = { xmin: b.xmin, ymin: b.ymin, xmax: b.xmax, ymax: b.ymax };
    const cells = bboxToCells(bbox, H3_RESOLUTION);
    const area = (b.xmax - b.xmin) * (b.ymax - b.ymin);
    const hasMatchedCategory = baseResources.cat !== null;
    const weight = calculateBuildingWeight(b.id, area, hasMatchedCategory);

    return {
      id: b.id,
      xmin: b.xmin,
      ymin: b.ymin,
      xmax: b.xmax,
      ymax: b.ymax,
      categories,
      resources,
      weight,
      area,
      cells
    };
  });

  const matchedCount = processedBuildings.filter(b => b.resources.cat !== null).length;
  console.log(`Found ${rawBuildings.length} buildings (${matchedCount} matched with places)`);

  // Log resource distribution before limiting
  const beforeCounts = {
    food: processedBuildings.filter(b => b.resources.food).length,
    equipment: processedBuildings.filter(b => b.resources.equipment).length,
    energy: processedBuildings.filter(b => b.resources.energy).length,
    materials: processedBuildings.filter(b => b.resources.materials).length,
    none: processedBuildings.filter(b => !b.resources.food && !b.resources.equipment && !b.resources.energy && !b.resources.materials).length
  };
  console.log(`Before limiting - Food: ${beforeCounts.food}, Equipment: ${beforeCounts.equipment}, Energy: ${beforeCounts.energy}, Materials: ${beforeCounts.materials}, None: ${beforeCounts.none}`);

  // Apply per-hex limiting
  const limitedBuildings = limitBuildingsPerHex(processedBuildings, MAX_BUILDINGS_PER_HEX_PER_TYPE);

  // Log resource distribution after limiting
  const afterCounts = {
    food: limitedBuildings.filter(b => b.resources.food).length,
    equipment: limitedBuildings.filter(b => b.resources.equipment).length,
    energy: limitedBuildings.filter(b => b.resources.energy).length,
    materials: limitedBuildings.filter(b => b.resources.materials).length
  };

  // Count unique hexes
  const allHexes = new Set<string>();
  limitedBuildings.forEach(b => b.cells.forEach(c => allHexes.add(c)));

  console.log(`After limiting to ${MAX_BUILDINGS_PER_HEX_PER_TYPE} per type per hex: ${limitedBuildings.length} buildings across ${allHexes.size} hexes`);
  console.log(`After limiting - Food: ${afterCounts.food}, Equipment: ${afterCounts.equipment}, Energy: ${afterCounts.energy}, Materials: ${afterCounts.materials}`);

  const client = await pgPool.connect();
  try {
    const CHUNK_SIZE = 1000;
    let count = 0;

    await client.query("BEGIN");

    for (let i = 0; i < limitedBuildings.length; i += CHUNK_SIZE) {
      const chunk = limitedBuildings.slice(i, i + CHUNK_SIZE);
      const values: any[] = [];
      const placeHolders: string[] = [];
      const mappingRows: Array<[string, string]> = [];
      const hexesToCreate = new Set<string>();

      chunk.forEach((b, idx) => {
        const offset = idx * 13;

        b.cells.forEach((cell) => {
          hexesToCreate.add(cell);
          mappingRows.push([b.id, cell]);
          regionHexes.add(cell);
        });

        placeHolders.push(
          `($${offset + 1}, 'building', $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13})`
        );
        values.push(
          b.id,
          region.regionId,
          b.xmin,
          b.ymin,
          b.xmax,
          b.ymax,
          JSON.stringify({ categories: b.categories }),
          null, // road_class
          b.resources.cat,
          b.resources.food,
          b.resources.equipment,
          b.resources.energy,
          b.resources.materials
        );
      });

      await insertHexCells(
        client,
        Array.from(hexesToCreate),
        region.regionId,
        centerLat,
        centerLon
      );

      await client.query(buildBuildingsUpsertQuery(placeHolders), values);

      await client.query(
        "DELETE FROM world_feature_hex_cells WHERE gers_id = ANY($1::text[])",
        [chunk.map((b) => b.id)]
      );

      await insertWorldFeatureHexCells(client, mappingRows);

      count += chunk.length;
      process.stdout.write(".");
    }

    // Verify world_feature_hex_cells were inserted
    const hexCellCheck = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text as count FROM world_feature_hex_cells wfh JOIN world_features wf ON wfh.gers_id = wf.gers_id WHERE wf.feature_type = 'building' AND wf.region_id = $1",
      [region.regionId]
    );
    console.log(`\nVerify: ${hexCellCheck.rows[0]?.count || 0} building-to-hex mappings in world_feature_hex_cells`);

    await client.query("COMMIT");
    console.log(`Success! Inserted ${count} buildings.`);
  } finally {
    client.release();
  }
}

async function main() {
  const pgPool = new Pool(DB_CONFIG);
  
  try {
    await pgPool.query("SELECT 1");
    console.log("Connected to Postgres.");

    const region = getRegionConfig();
    const dataDir = await runOvertureDownload(region, { clean: hasFlag("--clean") });

    // 1. Ingest Roads
    console.log("--- Starting Road Ingest ---");

    const roadsPath = resolveOverturePath(dataDir, { theme: "transportation", type: "segment" });
    
    await runDuckDB(buildRoadsQuery(roadsPath, region));
    
    const roads = await runDuckDB(`
      SELECT 
        id,
        bbox.xmin as xmin,
        bbox.ymin as ymin,
        bbox.xmax as xmax,
        bbox.ymax as ymax,
        class
      FROM roads_raw
    `);

    console.log(`Processing ${roads.length} roads...`);

    const client = await pgPool.connect();
    
    // Create region entry
    const bboxPoly = `POLYGON((${region.bbox.xmin} ${region.bbox.ymin}, ${region.bbox.xmin} ${region.bbox.ymax}, ${region.bbox.xmax} ${region.bbox.ymax}, ${region.bbox.xmax} ${region.bbox.ymin}, ${region.bbox.xmin} ${region.bbox.ymin}))`;
    
    await client.query(`
      INSERT INTO regions (region_id, name, boundary, center, distance_from_center)
      VALUES ($1, $2, ST_GeomFromText($3, 4326), ST_Centroid(ST_GeomFromText($3, 4326)), 0)
      ON CONFLICT (region_id) DO NOTHING
    `, [region.regionId, region.regionName, bboxPoly]);
    
    const centerLon = (region.bbox.xmin + region.bbox.xmax) / 2;
    const centerLat = (region.bbox.ymin + region.bbox.ymax) / 2;
    const regionHexes = new Set<string>();
    
    await client.query("BEGIN");
    
    // Batch insert roads
    console.log(`Inserting roads in batches...`);
    
    const CHUNK_SIZE = 1000;
    let count = 0;
    
    for (let i = 0; i < roads.length; i += CHUNK_SIZE) {
      const chunk = roads.slice(i, i + CHUNK_SIZE);
      const values: any[] = [];
      const placeHolders: string[] = [];
      const mappingRows: Array<[string, string]> = [];
      const hexesToCreate = new Set<string>();
      
      chunk.forEach((r: any, idx: number) => {
        const offset = idx * 8;
        const bbox = { xmin: r.xmin, ymin: r.ymin, xmax: r.xmax, ymax: r.ymax };
        const cells = bboxToCells(bbox, H3_RESOLUTION);

        cells.forEach((cell) => {
          hexesToCreate.add(cell);
          mappingRows.push([r.id, cell]);
          regionHexes.add(cell);
        });

        placeHolders.push(
          `($${offset + 1}, 'road', $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`
        );
        values.push(
          r.id, 
          region.regionId,
          r.xmin,
          r.ymin,
          r.xmax,
          r.ymax,
          JSON.stringify({ original_class: r.class }),
          r.class
        );
      });

      await insertHexCells(
        client,
        Array.from(hexesToCreate),
        region.regionId,
        centerLat,
        centerLon
      );
      
      const query = `
        INSERT INTO world_features (
          gers_id,
          feature_type,
          region_id,
          bbox_xmin,
          bbox_ymin,
          bbox_xmax,
          bbox_ymax,
          properties,
          road_class
        ) VALUES ${placeHolders.join(", ")}
        ON CONFLICT (gers_id) DO UPDATE SET 
          bbox_xmin = EXCLUDED.bbox_xmin,
          bbox_ymin = EXCLUDED.bbox_ymin,
          bbox_xmax = EXCLUDED.bbox_xmax,
          bbox_ymax = EXCLUDED.bbox_ymax,
          properties = EXCLUDED.properties,
          road_class = EXCLUDED.road_class
      `;
      
      await client.query(query, values);

      await client.query(
        "DELETE FROM world_feature_hex_cells WHERE gers_id = ANY($1::text[])",
        [chunk.map((r: any) => r.id)]
      );

      await insertWorldFeatureHexCells(client, mappingRows);
      
      const stateValues: any[] = [];
      const statePlaceHolders: string[] = [];
      chunk.forEach((r: any, idx: number) => {
        const offset = idx * 1;
        statePlaceHolders.push(`($${offset+1}, 100, 'normal')`);
        stateValues.push(r.id);
      });
      
      await client.query(`
        INSERT INTO feature_state (gers_id, health, status)
        VALUES ${statePlaceHolders.join(", ")}
        ON CONFLICT (gers_id) DO NOTHING
      `, stateValues);

      count += chunk.length;
      process.stdout.write(".");
    }
    
    await client.query("COMMIT");
    client.release();
    console.log(`\nSuccess! Inserted ${count} roads.`);
    
    // 2. Ingest Buildings
    await ingestBuildings(pgPool, region, centerLat, centerLon, dataDir, regionHexes);

    const pruneClient = await pgPool.connect();
    try {
      console.log("--- H3 Cell Cleanup ---");
      await pruneHexCells(pruneClient, region.regionId, regionHexes);
    } finally {
      pruneClient.release();
    }

    console.log("--- Land Ratio Update ---");
    await updateLandRatios(pgPool, region, dataDir, regionHexes);

    // Assign hub buildings per hex
    await assignHubBuildings(pgPool, region);

    // Build road connectivity graph for pathfinding
    await ingestRoadGraph(pgPool, region, dataDir);

    if (shouldSeedDemo()) {
      await seedDemoData(pgPool, region);
    }

  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  } finally {
    await pgPool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
