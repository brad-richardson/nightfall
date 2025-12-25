import { spawn } from "child_process";
import { Pool, type PoolClient } from "pg";
import { latLngToCell, cellToLatLng, polygonToCells } from "h3-js";
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
  { type: "place", theme: "places" }
];
const DUCKDB_BIN = path.resolve(__dirname, "../bin/duckdb");

const DB_CONFIG = {
  connectionString: process.env.DATABASE_URL || "postgresql://nightfall:nightfall@localhost:5432/nightfall?sslmode=disable",
};

const DEFAULT_REGION_ID = "boston_ma_usa";

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
            cost_labor,
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
              WHEN 'motorway' THEN 100
              WHEN 'trunk' THEN 80
              WHEN 'primary' THEN 60
              WHEN 'secondary' THEN 40
              WHEN 'tertiary' THEN 30
              WHEN 'residential' THEN 20
              WHEN 'track' THEN 15
              ELSE 20
            END AS cost_labor,
            CASE wf.road_class
              WHEN 'motorway' THEN 100
              WHEN 'trunk' THEN 80
              WHEN 'primary' THEN 60
              WHEN 'secondary' THEN 40
              WHEN 'tertiary' THEN 30
              WHEN 'residential' THEN 20
              WHEN 'track' THEN 15
              ELSE 20
            END AS cost_materials,
            CASE wf.road_class
              WHEN 'motorway' THEN 120
              WHEN 'trunk' THEN 100
              WHEN 'primary' THEN 80
              WHEN 'secondary' THEN 60
              WHEN 'tertiary' THEN 50
              WHEN 'residential' THEN 40
              WHEN 'track' THEN 35
              ELSE 40
            END AS duration_s,
            CASE wf.road_class
              WHEN 'motorway' THEN 30
              WHEN 'trunk' THEN 30
              WHEN 'primary' THEN 25
              WHEN 'secondary' THEN 25
              WHEN 'tertiary' THEN 20
              WHEN 'residential' THEN 20
              WHEN 'track' THEN 18
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

  // 3. Join
  const buildings = await runDuckDB(`
    SELECT 
      b.id, 
      b.bbox.xmin as xmin,
      b.bbox.ymin as ymin,
      b.bbox.xmax as xmax,
      b.bbox.ymax as ymax,
      p.categories
    FROM buildings_raw b
    LEFT JOIN places_raw p ON ST_Contains(b.geometry, p.geometry)
  `);

  console.log(`Processing ${buildings.length} buildings...`);

  const client = await pgPool.connect();
  try {
    const CHUNK_SIZE = 1000;
    let count = 0;
    
    function normalizeCategories(raw: unknown) {
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

    function getPrimaryCategory(categories: any) {
      if (!categories) {
        return null;
      }
      if (typeof categories.primary === "string") {
        return categories.primary;
      }
      if (Array.isArray(categories) && typeof categories[0]?.primary === "string") {
        return categories[0].primary;
      }
      return null;
    }

    function getResources(categories: any) {
      const primary = getPrimaryCategory(categories);
      if (!primary) {
        return { labor: false, materials: false, cat: null };
      }
      const cat = primary.toLowerCase();
      
      const labor = ["restaurant", "cafe", "bar", "food", "office", "retail", "shop", "store", "school", "university", "hospital"].some(k => cat.includes(k));
      const materials = ["industrial", "factory", "warehouse", "manufacturing", "construction"].some(k => cat.includes(k));
      
      return { labor, materials, cat };
    }

    await client.query("BEGIN");
    
    for (let i = 0; i < buildings.length; i += CHUNK_SIZE) {
      const chunk = buildings.slice(i, i + CHUNK_SIZE);
      const values: any[] = [];
      const placeHolders: string[] = [];
      const mappingRows: Array<[string, string]> = [];
      const hexesToCreate = new Set<string>();
      
      chunk.forEach((b: any, idx: number) => {
        const offset = idx * 11;
        const categories = normalizeCategories(b.categories);
        const res = getResources(categories);
        const bbox = { xmin: b.xmin, ymin: b.ymin, xmax: b.xmax, ymax: b.ymax };
        const cells = bboxToCells(bbox, H3_RESOLUTION);

        cells.forEach((cell) => {
          hexesToCreate.add(cell);
          mappingRows.push([b.id, cell]);
          regionHexes.add(cell);
        });
        
        placeHolders.push(
          `($${offset + 1}, 'building', $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11})`
        );
        values.push(
          b.id, 
          region.regionId,
          b.xmin,
          b.ymin,
          b.xmax,
          b.ymax,
          JSON.stringify({ categories }), 
          null, // road_class
          res.cat,
          res.labor,
          res.materials
        );
      });

      await insertHexCells(
        client,
        Array.from(hexesToCreate),
        region.regionId,
        centerLat,
        centerLon
      );
      
      await client.query(`
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
          generates_labor,
          generates_materials
        ) VALUES ${placeHolders.join(", ")}
        ON CONFLICT (gers_id) DO NOTHING
      `, values);

      await client.query(
        "DELETE FROM world_feature_hex_cells WHERE gers_id = ANY($1::text[])",
        [chunk.map((b: any) => b.id)]
      );

      await insertWorldFeatureHexCells(client, mappingRows);
      
      count += chunk.length;
      process.stdout.write(".");
    }
    
    await client.query("COMMIT");
    console.log(`\nSuccess! Inserted ${count} buildings.`);
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
      await pruneHexCells(pruneClient, region.regionId, regionHexes);
    } finally {
      pruneClient.release();
    }

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
