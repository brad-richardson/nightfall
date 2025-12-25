import { spawn } from "child_process";
import { Pool, type PoolClient } from "pg";
import { latLngToCell, cellToLatLng, polygonToCells } from "h3-js";
import * as dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

type Bbox = {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
};

type RegionConfig = {
  regionId: string;
  regionName: string;
  bbox: Bbox;
};

const BOSTON_BBOX: Bbox = {
  xmin: -71.1912,
  ymin: 42.2279,
  xmax: -70.9201,
  ymax: 42.3974,
};

const BAR_HARBOR_DEMO_BBOX: Bbox = {
  xmin: -68.35,
  ymin: 44.31,
  xmax: -68.15,
  ymax: 44.45,
};

export const H3_RESOLUTION = 7;
const OVERTURE_TYPES = ["transportation/segment", "buildings/building", "places/place"];
const DUCKDB_BIN = path.resolve(__dirname, "../bin/duckdb");

const DB_CONFIG = {
  connectionString: process.env.DATABASE_URL || "postgresql://nightfall:nightfall@localhost:5432/nightfall?sslmode=disable",
};

export const ROAD_CLASS_FILTER = [
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "residential",
  "track"
];

export const REGION_CONFIGS: Record<string, RegionConfig> = {
  boston_ma_usa: {
    regionId: "boston_ma_usa",
    regionName: "Boston, MA, USA",
    bbox: BOSTON_BBOX
  },
  bar_harbor_me_usa_demo: {
    regionId: "bar_harbor_me_usa_demo",
    regionName: "Bar Harbor, ME, USA (Demo)",
    bbox: BAR_HARBOR_DEMO_BBOX
  }
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

async function runOvertureDownload(region: RegionConfig) {
  const dataDir = getOvertureDataDir(region);

  await fs.promises.mkdir(dataDir, { recursive: true });

  const bboxArg = `${region.bbox.xmin},${region.bbox.ymin},${region.bbox.xmax},${region.bbox.ymax}`;
  const args = ["download", `--bbox=${bboxArg}`, "-o", dataDir];

  for (const type of OVERTURE_TYPES) {
    args.push(`--type=${type}`);
  }

  console.log("Overture: Downloading latest data...");

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

  return dataDir;
}

function resolveOverturePath(dataDir: string, theme: string, type: string) {
  const themeDir = path.resolve(dataDir, `theme=${theme}`, `type=${type}`);
  if (fs.existsSync(themeDir)) {
    return path.join(themeDir, "*");
  }

  const altDir = path.resolve(dataDir, theme, type);
  if (fs.existsSync(altDir)) {
    return path.join(altDir, "*");
  }

  throw new Error(`Overture data not found for ${theme}/${type} in ${dataDir}`);
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
  dataDir: string
) {
  console.log("--- Starting Building Ingest ---");

  const buildingsPath = resolveOverturePath(dataDir, "buildings", "building");
  const placesPath = resolveOverturePath(dataDir, "places", "place");
  
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
    
    function getResources(categories: any) {
      if (!categories || !categories.primary) return { labor: false, materials: false, cat: null };
      const cat = categories.primary.toLowerCase();
      
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
        const res = getResources(b.categories ? JSON.parse(b.categories) : null);
        const bbox = { xmin: b.xmin, ymin: b.ymin, xmax: b.xmax, ymax: b.ymax };
        const cells = bboxToCells(bbox, H3_RESOLUTION);

        cells.forEach((cell) => {
          hexesToCreate.add(cell);
          mappingRows.push([b.id, cell]);
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
          JSON.stringify({ categories: b.categories }), 
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
    const dataDir = await runOvertureDownload(region);

    // 1. Ingest Roads
    console.log("--- Starting Road Ingest ---");

    const roadsPath = resolveOverturePath(dataDir, "transportation", "segment");
    
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
    await ingestBuildings(pgPool, region, centerLat, centerLon, dataDir);

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
