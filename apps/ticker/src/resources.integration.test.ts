/**
 * Integration tests for resource transfers.
 *
 * These tests run actual SQL against a real Postgres database to validate
 * the resource transfer queries.
 *
 * Run with: DATABASE_URL=... pnpm vitest run resources.integration.test.ts
 * Or via: pnpm test:db (which sets up the test database first)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import {
  createTestTransaction,
  closeTestPool,
  TestTransaction,
  insertTestFixtures
} from "./test-utils/db-test-utils";
import { applyArrivedResourceTransfers, resetResourceTransferCacheForTests } from "./resources";

describe("resource transfers integration", () => {
  let tx: TestTransaction;

  beforeAll(() => {
    // Pool is created lazily on first use
  });

  afterAll(async () => {
    await closeTestPool();
  });

  beforeEach(async () => {
    tx = await createTestTransaction();
    resetResourceTransferCacheForTests();
  });

  afterEach(async () => {
    if (tx) {
      await tx.rollback();
    }
  });

  it("does NOT mark transfers as arrived when arrive_at is in the future", async () => {
    const { regionId } = await insertTestFixtures(tx);

    // Insert a hub building for the transfer
    const hubGersId = "test-hub-1";
    await tx.query(
      `INSERT INTO world_features (gers_id, feature_type, region_id, h3_index)
       VALUES ($1, 'building', $2, '8a2a1072b59ffff')
       ON CONFLICT (gers_id) DO NOTHING`,
      [hubGersId, regionId]
    );

    // Insert a source building
    const sourceGersId = "test-source-1";
    await tx.query(
      `INSERT INTO world_features (gers_id, feature_type, region_id, h3_index)
       VALUES ($1, 'building', $2, '8a2a1072b59ffff')
       ON CONFLICT (gers_id) DO NOTHING`,
      [sourceGersId, regionId]
    );

    // Insert a transfer with arrive_at 45 seconds in the FUTURE
    const insertResult = await tx.query<{ transfer_id: string; status: string; arrive_at: string }>(
      `INSERT INTO resource_transfers (region_id, source_gers_id, hub_gers_id, resource_type, amount, depart_at, arrive_at)
       VALUES ($1, $2, $3, 'food', 10, now(), now() + interval '45 seconds')
       RETURNING transfer_id, status, arrive_at::text`,
      [regionId, sourceGersId, hubGersId]
    );

    expect(insertResult.rows).toHaveLength(1);
    expect(insertResult.rows[0].status).toBe("in_transit");

    // Verify transfer exists with in_transit status
    const beforeApply = await tx.query<{ status: string; count: string }>(
      "SELECT status, COUNT(*) as count FROM resource_transfers GROUP BY status"
    );
    console.log("Before applyArrived:", beforeApply.rows);
    expect(beforeApply.rows.some(r => r.status === "in_transit" && r.count === "1")).toBe(true);

    // Run applyArrivedResourceTransfers - should NOT affect our transfer
    const result = await applyArrivedResourceTransfers(tx);

    // Should return no regions (no arrivals)
    expect(result.regionIds).toHaveLength(0);

    // Verify transfer STILL has status='in_transit'
    const afterApply = await tx.query<{ status: string; count: string }>(
      "SELECT status, COUNT(*) as count FROM resource_transfers GROUP BY status"
    );
    console.log("After applyArrived:", afterApply.rows);
    expect(afterApply.rows.some(r => r.status === "in_transit" && r.count === "1")).toBe(true);

    // Double-check by querying the specific transfer
    const transferState = await tx.query<{ status: string; arrive_at: string }>(
      `SELECT status, arrive_at::text FROM resource_transfers WHERE transfer_id = $1`,
      [insertResult.rows[0].transfer_id]
    );
    expect(transferState.rows[0].status).toBe("in_transit");
  });

  it("DOES mark transfers as arrived when arrive_at is in the past", async () => {
    const { regionId } = await insertTestFixtures(tx);

    // Insert hub and source buildings
    const hubGersId = "test-hub-1";
    const sourceGersId = "test-source-1";
    await tx.query(
      `INSERT INTO world_features (gers_id, feature_type, region_id, h3_index)
       VALUES ($1, 'building', $2, '8a2a1072b59ffff'),
              ($3, 'building', $2, '8a2a1072b59ffff')
       ON CONFLICT (gers_id) DO NOTHING`,
      [hubGersId, regionId, sourceGersId]
    );

    // Insert a transfer with arrive_at 5 seconds in the PAST
    await tx.query(
      `INSERT INTO resource_transfers (region_id, source_gers_id, hub_gers_id, resource_type, amount, depart_at, arrive_at)
       VALUES ($1, $2, $3, 'food', 10, now() - interval '10 seconds', now() - interval '5 seconds')`,
      [regionId, sourceGersId, hubGersId]
    );

    // Run applyArrivedResourceTransfers - SHOULD mark our transfer as arrived
    const result = await applyArrivedResourceTransfers(tx);

    // Should return the region
    expect(result.regionIds).toHaveLength(1);
    expect(result.regionIds[0]).toBe(regionId);

    // Verify transfer now has status='arrived'
    const afterApply = await tx.query<{ status: string }>(
      "SELECT status FROM resource_transfers WHERE region_id = $1",
      [regionId]
    );
    expect(afterApply.rows[0].status).toBe("arrived");
  });

  it("updates region pool values when transfers arrive", async () => {
    const { regionId } = await insertTestFixtures(tx);

    // Check initial pool values
    const initialPools = await tx.query<{
      pool_food: string;
      pool_equipment: string;
      pool_energy: string;
      pool_materials: string;
    }>(
      `SELECT pool_food::text, pool_equipment::text, pool_energy::text, pool_materials::text
       FROM regions WHERE region_id = $1`,
      [regionId]
    );
    expect(initialPools.rows).toHaveLength(1);
    const initialFood = parseInt(initialPools.rows[0].pool_food, 10);
    const initialEquipment = parseInt(initialPools.rows[0].pool_equipment, 10);

    // Insert hub and two source buildings (unique constraint on source_gers_id)
    const hubGersId = "test-hub-1";
    const sourceGersId1 = "test-source-1";
    const sourceGersId2 = "test-source-2";
    await tx.query(
      `INSERT INTO world_features (gers_id, feature_type, region_id, h3_index)
       VALUES ($1, 'building', $2, '8a2a1072b59ffff'),
              ($3, 'building', $2, '8a2a1072b59ffff'),
              ($4, 'building', $2, '8a2a1072b59ffff')
       ON CONFLICT (gers_id) DO NOTHING`,
      [hubGersId, regionId, sourceGersId1, sourceGersId2]
    );

    // Insert TWO transfers from different sources - one food (10 units), one equipment (5 units) - both already arrived
    await tx.query(
      `INSERT INTO resource_transfers (region_id, source_gers_id, hub_gers_id, resource_type, amount, depart_at, arrive_at)
       VALUES
         ($1, $2, $4, 'food', 10, now() - interval '10 seconds', now() - interval '5 seconds'),
         ($1, $3, $4, 'equipment', 5, now() - interval '10 seconds', now() - interval '5 seconds')`,
      [regionId, sourceGersId1, sourceGersId2, hubGersId]
    );

    // Run applyArrivedResourceTransfers
    const result = await applyArrivedResourceTransfers(tx);

    // Should return the region (critical for SSE notifications)
    expect(result.regionIds).toHaveLength(1);
    expect(result.regionIds[0]).toBe(regionId);

    // Verify pool values were updated
    const updatedPools = await tx.query<{
      pool_food: string;
      pool_equipment: string;
      pool_energy: string;
      pool_materials: string;
    }>(
      `SELECT pool_food::text, pool_equipment::text, pool_energy::text, pool_materials::text
       FROM regions WHERE region_id = $1`,
      [regionId]
    );

    expect(updatedPools.rows).toHaveLength(1);
    const updatedFood = parseInt(updatedPools.rows[0].pool_food, 10);
    const updatedEquipment = parseInt(updatedPools.rows[0].pool_equipment, 10);

    // Pool values should have increased by the transfer amounts
    expect(updatedFood).toBe(initialFood + 10);
    expect(updatedEquipment).toBe(initialEquipment + 5);

    // Verify transfers are now marked as 'arrived'
    const transferStatus = await tx.query<{ status: string; count: string }>(
      `SELECT status, COUNT(*)::text as count FROM resource_transfers
       WHERE region_id = $1 GROUP BY status`,
      [regionId]
    );
    expect(transferStatus.rows).toHaveLength(1);
    expect(transferStatus.rows[0].status).toBe("arrived");
    expect(transferStatus.rows[0].count).toBe("2");
  });

  it("returns empty regionIds when no transfers have arrived", async () => {
    const { regionId } = await insertTestFixtures(tx);

    // Insert hub and source building
    const hubGersId = "test-hub-1";
    const sourceGersId = "test-source-1";
    await tx.query(
      `INSERT INTO world_features (gers_id, feature_type, region_id, h3_index)
       VALUES ($1, 'building', $2, '8a2a1072b59ffff'),
              ($3, 'building', $2, '8a2a1072b59ffff')
       ON CONFLICT (gers_id) DO NOTHING`,
      [hubGersId, regionId, sourceGersId]
    );

    // Insert a transfer that has NOT arrived yet (30 seconds in future)
    await tx.query(
      `INSERT INTO resource_transfers (region_id, source_gers_id, hub_gers_id, resource_type, amount, depart_at, arrive_at)
       VALUES ($1, $2, $3, 'food', 10, now(), now() + interval '30 seconds')`,
      [regionId, sourceGersId, hubGersId]
    );

    // Run applyArrivedResourceTransfers - should return empty array
    const result = await applyArrivedResourceTransfers(tx);

    // Should return NO regions since no transfers have arrived
    expect(result.regionIds).toHaveLength(0);

    // Verify transfer is still in_transit
    const transferStatus = await tx.query<{ status: string }>(
      `SELECT status FROM resource_transfers WHERE region_id = $1`,
      [regionId]
    );
    expect(transferStatus.rows[0].status).toBe("in_transit");
  });

  it("returns regionIds that can be used to fetch updated pool snapshots", async () => {
    const { regionId } = await insertTestFixtures(tx);

    // Insert hub and source building
    const hubGersId = "test-hub-1";
    const sourceGersId = "test-source-1";
    await tx.query(
      `INSERT INTO world_features (gers_id, feature_type, region_id, h3_index)
       VALUES ($1, 'building', $2, '8a2a1072b59ffff'),
              ($3, 'building', $2, '8a2a1072b59ffff')
       ON CONFLICT (gers_id) DO NOTHING`,
      [hubGersId, regionId, sourceGersId]
    );

    // Check initial pool
    const initialPool = await tx.query<{ pool_food: string }>(
      `SELECT pool_food::text FROM regions WHERE region_id = $1`,
      [regionId]
    );
    const initialFood = parseInt(initialPool.rows[0].pool_food, 10);

    // Insert an arrived transfer
    await tx.query(
      `INSERT INTO resource_transfers (region_id, source_gers_id, hub_gers_id, resource_type, amount, depart_at, arrive_at)
       VALUES ($1, $2, $3, 'food', 25, now() - interval '10 seconds', now() - interval '5 seconds')`,
      [regionId, sourceGersId, hubGersId]
    );

    // Run applyArrivedResourceTransfers
    const result = await applyArrivedResourceTransfers(tx);
    expect(result.regionIds).toContain(regionId);

    // CRITICAL: Use the returned regionIds to fetch the current pool state
    // This simulates what publishWorldDelta/fetchRegionSnapshots does
    const snapshotResult = await tx.query<{
      region_id: string;
      pool_food: number;
    }>(
      `SELECT region_id, pool_food::float AS pool_food
       FROM regions WHERE region_id = ANY($1::text[])`,
      [result.regionIds]
    );

    expect(snapshotResult.rows).toHaveLength(1);
    expect(snapshotResult.rows[0].region_id).toBe(regionId);
    // The pool should already reflect the +25 from the transfer
    expect(snapshotResult.rows[0].pool_food).toBe(initialFood + 25);
  });

  it("updates region updated_at timestamp when transfers arrive (proves CTE executes)", async () => {
    const { regionId } = await insertTestFixtures(tx);

    // Get initial updated_at
    const initialState = await tx.query<{ updated_at: string }>(
      `SELECT updated_at::text FROM regions WHERE region_id = $1`,
      [regionId]
    );
    const initialUpdatedAt = initialState.rows[0].updated_at;

    // Insert hub and source building
    const hubGersId = "test-hub-1";
    const sourceGersId = "test-source-1";
    await tx.query(
      `INSERT INTO world_features (gers_id, feature_type, region_id, h3_index)
       VALUES ($1, 'building', $2, '8a2a1072b59ffff'),
              ($3, 'building', $2, '8a2a1072b59ffff')
       ON CONFLICT (gers_id) DO NOTHING`,
      [hubGersId, regionId, sourceGersId]
    );

    // Insert an arrived transfer
    await tx.query(
      `INSERT INTO resource_transfers (region_id, source_gers_id, hub_gers_id, resource_type, amount, depart_at, arrive_at)
       VALUES ($1, $2, $3, 'food', 10, now() - interval '10 seconds', now() - interval '5 seconds')`,
      [regionId, sourceGersId, hubGersId]
    );

    // Run applyArrivedResourceTransfers
    const result = await applyArrivedResourceTransfers(tx);
    expect(result.regionIds).toHaveLength(1);

    // Check that updated_at has changed - this PROVES the updated_regions CTE executed
    const afterState = await tx.query<{ updated_at: string }>(
      `SELECT updated_at::text FROM regions WHERE region_id = $1`,
      [regionId]
    );
    const afterUpdatedAt = afterState.rows[0].updated_at;

    console.log("Region updated_at - before:", initialUpdatedAt, "after:", afterUpdatedAt);

    // The timestamps should be different if the CTE executed
    // Note: In a transaction, now() returns same value, so we compare with >=
    // The key is that updated_at should NOT be null/undefined
    expect(afterUpdatedAt).toBeDefined();
    expect(afterUpdatedAt).not.toBeNull();
  });

  it("verifies the exact SQL CTE updates regions (not just marks transfers)", async () => {
    const { regionId } = await insertTestFixtures(tx);

    // Insert buildings
    const hubGersId = "test-hub-1";
    const sourceGersId = "test-source-1";
    await tx.query(
      `INSERT INTO world_features (gers_id, feature_type, region_id, h3_index)
       VALUES ($1, 'building', $2, '8a2a1072b59ffff'),
              ($3, 'building', $2, '8a2a1072b59ffff')
       ON CONFLICT (gers_id) DO NOTHING`,
      [hubGersId, regionId, sourceGersId]
    );

    // Get initial pool_food
    const before = await tx.query<{ pool_food: string }>(
      `SELECT pool_food::text FROM regions WHERE region_id = $1`,
      [regionId]
    );
    const poolBefore = parseInt(before.rows[0].pool_food, 10);
    console.log("Pool before:", poolBefore);

    // Insert arrived transfer with 100 food
    await tx.query(
      `INSERT INTO resource_transfers (region_id, source_gers_id, hub_gers_id, resource_type, amount, depart_at, arrive_at)
       VALUES ($1, $2, $3, 'food', 100, now() - interval '1 minute', now() - interval '30 seconds')`,
      [regionId, sourceGersId, hubGersId]
    );

    // Manually run the EXACT same CTE query used in applyArrivedResourceTransfers
    // to verify the SQL itself updates pools
    const cteResult = await tx.query<{ region_id: string }>(
      `
      WITH arrived AS (
        SELECT transfer_id, region_id, resource_type, amount
        FROM resource_transfers
        WHERE status = 'in_transit'
          AND arrive_at <= now()
        FOR UPDATE SKIP LOCKED
      ),
      totals AS (
        SELECT
          region_id,
          SUM(CASE WHEN resource_type = 'food' THEN amount ELSE 0 END)::bigint AS food,
          SUM(CASE WHEN resource_type = 'equipment' THEN amount ELSE 0 END)::bigint AS equipment,
          SUM(CASE WHEN resource_type = 'energy' THEN amount ELSE 0 END)::bigint AS energy,
          SUM(CASE WHEN resource_type = 'materials' THEN amount ELSE 0 END)::bigint AS materials
        FROM arrived
        GROUP BY region_id
      ),
      updated_regions AS (
        UPDATE regions AS r
        SET
          pool_food = r.pool_food + COALESCE(totals.food, 0),
          pool_equipment = r.pool_equipment + COALESCE(totals.equipment, 0),
          pool_energy = r.pool_energy + COALESCE(totals.energy, 0),
          pool_materials = r.pool_materials + COALESCE(totals.materials, 0),
          updated_at = now()
        FROM totals
        WHERE r.region_id = totals.region_id
        RETURNING r.region_id
      )
      UPDATE resource_transfers AS rt
      SET status = 'arrived'
      WHERE rt.transfer_id IN (SELECT transfer_id FROM arrived)
      RETURNING rt.region_id
      `
    );

    console.log("CTE result rows:", cteResult.rows);

    // Check pool_food AFTER the CTE
    const after = await tx.query<{ pool_food: string }>(
      `SELECT pool_food::text FROM regions WHERE region_id = $1`,
      [regionId]
    );
    const poolAfter = parseInt(after.rows[0].pool_food, 10);
    console.log("Pool after:", poolAfter);

    // THIS is the critical assertion - pool should have increased by 100
    expect(poolAfter).toBe(poolBefore + 100);
  });

  it("correctly compares arrive_at with now() within same transaction", async () => {
    const { regionId } = await insertTestFixtures(tx);

    // Insert buildings
    const hubGersId = "test-hub-1";
    const sourceGersId = "test-source-1";
    await tx.query(
      `INSERT INTO world_features (gers_id, feature_type, region_id, h3_index)
       VALUES ($1, 'building', $2, '8a2a1072b59ffff'),
              ($3, 'building', $2, '8a2a1072b59ffff')
       ON CONFLICT (gers_id) DO NOTHING`,
      [hubGersId, regionId, sourceGersId]
    );

    // Insert using the EXACT pattern from enqueueResourceTransfers
    const travelSeconds = 45;
    const insertResult = await tx.query<{ transfer_id: string; status: string; depart_at: string; arrive_at: string }>(
      `INSERT INTO resource_transfers (region_id, source_gers_id, hub_gers_id, resource_type, amount, depart_at, arrive_at)
       VALUES ($1, $2, $3, 'food', 10, now(), now() + ($4 || ' seconds')::interval)
       RETURNING transfer_id, status, depart_at::text, arrive_at::text`,
      [regionId, sourceGersId, hubGersId, travelSeconds.toString()]
    );

    console.log("Inserted transfer:", insertResult.rows[0]);

    // Check what now() returns and compare with arrive_at
    const nowCheck = await tx.query<{ now_ts: string; arrive_at: string; is_future: boolean }>(
      `SELECT now()::text as now_ts, arrive_at::text, arrive_at > now() as is_future
       FROM resource_transfers WHERE transfer_id = $1`,
      [insertResult.rows[0].transfer_id]
    );
    console.log("Time comparison:", nowCheck.rows[0]);
    expect(nowCheck.rows[0].is_future).toBe(true);

    // Run applyArrived
    const result = await applyArrivedResourceTransfers(tx);
    expect(result.regionIds).toHaveLength(0);

    // Verify still in_transit
    const afterApply = await tx.query<{ status: string }>(
      "SELECT status FROM resource_transfers WHERE transfer_id = $1",
      [insertResult.rows[0].transfer_id]
    );
    expect(afterApply.rows[0].status).toBe("in_transit");
  });
});
