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
