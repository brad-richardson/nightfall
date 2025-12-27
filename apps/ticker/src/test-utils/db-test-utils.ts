/**
 * Database test utilities for running integration tests against a real Postgres database.
 *
 * Uses transaction rollback pattern for fast, isolated tests:
 * - Each test runs inside a transaction
 * - Transaction is rolled back after each test (instant cleanup)
 * - Tests are fully isolated from each other
 *
 * Requires the test database to be running (via `pnpm test:db` or docker-compose.test.yml)
 */

import { Pool, PoolClient } from "pg";
import type { PoolLike, PoolClientLike } from "../ticker";

const TEST_DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://nightfall:nightfall@localhost:5433/nightfall?sslmode=disable";

let pool: Pool | null = null;

/**
 * Get the shared test pool. Creates the pool on first call.
 */
export function getTestPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: TEST_DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000
    });

    pool.on("error", (err: Error) => {
      console.error("Test pool error:", err);
    });
  }
  return pool;
}

/**
 * Close the test pool. Call this in afterAll().
 */
export async function closeTestPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * A test client wrapper that implements PoolLike for use in ticker functions.
 * All queries run within a transaction that will be rolled back.
 */
export class TestTransaction implements PoolLike {
  private client: PoolClient;
  private released = false;

  constructor(client: PoolClient) {
    this.client = client;
  }

  async query<T = unknown>(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: T[]; rowCount?: number | null }> {
    const result = await this.client.query(text, params);
    return { rows: result.rows as T[], rowCount: result.rowCount };
  }

  /**
   * Returns itself as the client (already in a transaction).
   * This allows code that uses pool.connect() to work with our test transaction.
   */
  async connect(): Promise<PoolClientLike> {
    return {
      query: this.query.bind(this),
      release: async () => {
        // No-op: release is handled by rollback()
      }
    };
  }

  /**
   * Rollback the transaction and release the client.
   * Call this in afterEach().
   */
  async rollback(): Promise<void> {
    if (!this.released) {
      await this.client.query("ROLLBACK");
      this.client.release();
      this.released = true;
    }
  }
}

/**
 * Create a new test transaction.
 * Call this in beforeEach() to get an isolated transaction for each test.
 *
 * @returns A TestTransaction that implements PoolLike
 *
 * @example
 * ```ts
 * let tx: TestTransaction;
 *
 * beforeEach(async () => {
 *   tx = await createTestTransaction();
 * });
 *
 * afterEach(async () => {
 *   await tx.rollback();
 * });
 *
 * it("runs queries in isolation", async () => {
 *   await tx.query("INSERT INTO regions ...");
 *   const result = await tx.query("SELECT * FROM regions");
 *   expect(result.rows).toHaveLength(1);
 * });
 * ```
 */
export async function createTestTransaction(): Promise<TestTransaction> {
  const testPool = getTestPool();
  const client = await testPool.connect();
  await client.query("BEGIN");
  return new TestTransaction(client);
}

/**
 * Helper to insert minimal test fixtures.
 * These are the minimum required rows to test most ticker functions.
 */
export async function insertTestFixtures(
  tx: PoolLike,
  options: {
    regionId?: string;
    hexIndex?: string;
    gersId?: string;
    crewId?: string;
    taskId?: string;
  } = {}
): Promise<{
  regionId: string;
  hexIndex: string;
  gersId: string;
  crewId: string;
}> {
  const regionId = options.regionId ?? "test-region-1";
  const hexIndex = options.hexIndex ?? "8a2a1072b59ffff";
  const gersId = options.gersId ?? "test-road-1";
  const crewId = options.crewId ?? "00000000-0000-0000-0000-000000000001";

  // Insert region with PostGIS geometry
  await tx.query(
    `INSERT INTO regions (region_id, name, boundary, center, distance_from_center)
     VALUES ($1, 'Test Region', ST_GeomFromText('POLYGON((-68.21 44.39, -68.20 44.39, -68.20 44.40, -68.21 44.40, -68.21 44.39))', 4326),
             ST_GeomFromText('POINT(-68.205 44.395)', 4326), 0)
     ON CONFLICT (region_id) DO NOTHING`,
    [regionId]
  );

  // Insert hex cell
  await tx.query(
    `INSERT INTO hex_cells (h3_index, region_id, rust_level, land_ratio, distance_from_center)
     VALUES ($1, $2, 0.5, 1.0, 0)
     ON CONFLICT (h3_index) DO NOTHING`,
    [hexIndex, regionId]
  );

  // Insert world feature (road)
  await tx.query(
    `INSERT INTO world_features (gers_id, feature_type, region_id, h3_index, road_class)
     VALUES ($1, 'road', $2, $3, 'secondary')
     ON CONFLICT (gers_id) DO NOTHING`,
    [gersId, regionId, hexIndex]
  );

  // Insert world_feature_hex_cells association
  await tx.query(
    `INSERT INTO world_feature_hex_cells (gers_id, h3_index)
     VALUES ($1, $2)
     ON CONFLICT (gers_id, h3_index) DO NOTHING`,
    [gersId, hexIndex]
  );

  // Insert feature state
  await tx.query(
    `INSERT INTO feature_state (gers_id, health, status)
     VALUES ($1, 50, 'degraded')
     ON CONFLICT (gers_id) DO NOTHING`,
    [gersId]
  );

  // Insert crew
  await tx.query(
    `INSERT INTO crews (crew_id, region_id, status)
     VALUES ($1, $2, 'idle')
     ON CONFLICT (crew_id) DO NOTHING`,
    [crewId, regionId]
  );

  return { regionId, hexIndex, gersId, crewId };
}
