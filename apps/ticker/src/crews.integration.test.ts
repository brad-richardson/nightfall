/**
 * Integration tests for crew task completion.
 *
 * These tests run actual SQL against a real Postgres database to validate
 * the complex CTE queries in completeFinishedTasks().
 *
 * Run with: DATABASE_URL=... pnpm vitest run crews.integration.test.ts
 * Or via: pnpm test:db (which sets up the test database first)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import {
  createTestTransaction,
  closeTestPool,
  TestTransaction,
  insertTestFixtures
} from "./test-utils/db-test-utils";
import { completeFinishedTasks } from "./crews";
import type { PhaseMultipliers } from "./multipliers";

// Day multipliers: rust_spread = 0.1, so pushback = 0.02 * max(0, 1.5 - 0.1) = 0.028
const DAY_MULTIPLIERS: PhaseMultipliers = {
  rust_spread: 0.1,
  decay: 0.2,
  generation: 1.5,
  repair_speed: 1.25
};

// Night multipliers: rust_spread = 1.0, so pushback = 0.02 * max(0, 1.5 - 1.0) = 0.01
const NIGHT_MULTIPLIERS: PhaseMultipliers = {
  rust_spread: 1.0,
  decay: 1.0,
  generation: 0.3,
  repair_speed: 0.75
};

describe("completeFinishedTasks integration", () => {
  let tx: TestTransaction;

  beforeAll(() => {
    // Pool is created lazily on first use
  });

  afterAll(async () => {
    await closeTestPool();
  });

  beforeEach(async () => {
    tx = await createTestTransaction();
  });

  afterEach(async () => {
    if (tx) {
      await tx.rollback();
    }
  });

  it("completes a task when crew busy_until has passed", async () => {
    const { regionId, hexIndex, gersId, crewId } = await insertTestFixtures(tx);

    // Create a task and assign it to the crew
    const taskResult = await tx.query<{ task_id: string }>(
      `INSERT INTO tasks (region_id, target_gers_id, task_type, cost_food, cost_equipment, cost_energy, cost_materials, duration_s, repair_amount, status)
       VALUES ($1, $2, 'repair', 10, 5, 5, 10, 60, 25, 'active')
       RETURNING task_id`,
      [regionId, gersId]
    );
    const taskId = taskResult.rows[0].task_id;

    // Set crew to 'working' with busy_until in the past
    await tx.query(
      `UPDATE crews SET status = 'working', active_task_id = $2, busy_until = now() - interval '1 second' WHERE crew_id = $1`,
      [crewId, taskId]
    );

    // Set initial health to 50 (degraded)
    await tx.query(`UPDATE feature_state SET health = 50, status = 'degraded' WHERE gers_id = $1`, [
      gersId
    ]);

    // Set initial rust level
    await tx.query(`UPDATE hex_cells SET rust_level = 0.5 WHERE h3_index = $1`, [hexIndex]);

    // Execute the function under test
    const result = await completeFinishedTasks(tx, DAY_MULTIPLIERS);

    // Verify task was completed
    expect(result.taskDeltas).toHaveLength(1);
    expect(result.taskDeltas[0].task_id).toBe(taskId);
    expect(result.taskDeltas[0].status).toBe("done");

    // Verify feature health was updated (50 + 25 = 75)
    expect(result.featureDeltas).toHaveLength(1);
    expect(result.featureDeltas[0].gers_id).toBe(gersId);
    expect(result.featureDeltas[0].health).toBe(75);
    expect(result.featureDeltas[0].status).toBe("normal"); // 75 >= 30 threshold

    // Verify rust pushback on hex cells
    expect(result.rustHexes).toHaveLength(1);
    expect(result.rustHexes[0].h3_index).toBe(hexIndex);
    // 0.5 - 0.028 = 0.472 (day pushback)
    expect(result.rustHexes[0].rust_level).toBeCloseTo(0.472, 2);

    // Verify database state
    const crewState = await tx.query<{ status: string; active_task_id: string | null }>(
      `SELECT status, active_task_id FROM crews WHERE crew_id = $1`,
      [crewId]
    );
    expect(crewState.rows[0].status).toBe("idle");
    expect(crewState.rows[0].active_task_id).toBeNull();

    const taskState = await tx.query<{ status: string; completed_at: Date | null }>(
      `SELECT status, completed_at FROM tasks WHERE task_id = $1`,
      [taskId]
    );
    expect(taskState.rows[0].status).toBe("done");
    expect(taskState.rows[0].completed_at).not.toBeNull();

    // Verify event was created
    const events = await tx.query<{ event_type: string; payload: { task_id: string } }>(
      `SELECT event_type, payload FROM events WHERE region_id = $1 ORDER BY ts DESC LIMIT 1`,
      [regionId]
    );
    expect(events.rows[0].event_type).toBe("task_complete");
    expect(events.rows[0].payload.task_id).toBe(taskId);
  });

  it("fully heals road to 100% health when repair completes", async () => {
    const { regionId, gersId, crewId } = await insertTestFixtures(tx);

    const taskResult = await tx.query<{ task_id: string }>(
      `INSERT INTO tasks (region_id, target_gers_id, task_type, cost_food, cost_equipment, cost_energy, cost_materials, duration_s, repair_amount, status)
       VALUES ($1, $2, 'repair', 10, 5, 5, 10, 60, 20, 'active')
       RETURNING task_id`,
      [regionId, gersId]
    );
    const taskId = taskResult.rows[0].task_id;

    await tx.query(
      `UPDATE crews SET status = 'working', active_task_id = $2, busy_until = now() - interval '1 second' WHERE crew_id = $1`,
      [crewId, taskId]
    );

    // Health at 15, should heal to 100 and become 'normal'
    await tx.query(`UPDATE feature_state SET health = 15, status = 'degraded' WHERE gers_id = $1`, [
      gersId
    ]);

    const result = await completeFinishedTasks(tx, DAY_MULTIPLIERS);

    expect(result.featureDeltas[0].health).toBe(100);
    expect(result.featureDeltas[0].status).toBe("normal");
  });

  it("caps health at 100", async () => {
    const { regionId, gersId, crewId } = await insertTestFixtures(tx);

    const taskResult = await tx.query<{ task_id: string }>(
      `INSERT INTO tasks (region_id, target_gers_id, task_type, cost_food, cost_equipment, cost_energy, cost_materials, duration_s, repair_amount, status)
       VALUES ($1, $2, 'repair', 10, 5, 5, 10, 60, 50, 'active')
       RETURNING task_id`,
      [regionId, gersId]
    );
    const taskId = taskResult.rows[0].task_id;

    await tx.query(
      `UPDATE crews SET status = 'working', active_task_id = $2, busy_until = now() - interval '1 second' WHERE crew_id = $1`,
      [crewId, taskId]
    );

    // Health at 80, repair_amount 50 -> should cap at 100
    await tx.query(`UPDATE feature_state SET health = 80, status = 'normal' WHERE gers_id = $1`, [
      gersId
    ]);

    const result = await completeFinishedTasks(tx, DAY_MULTIPLIERS);

    expect(result.featureDeltas[0].health).toBe(100);
    expect(result.featureDeltas[0].status).toBe("normal");
  });

  it("does not reduce rust level below zero", async () => {
    const { regionId, hexIndex, gersId, crewId } = await insertTestFixtures(tx);

    const taskResult = await tx.query<{ task_id: string }>(
      `INSERT INTO tasks (region_id, target_gers_id, task_type, cost_food, cost_equipment, cost_energy, cost_materials, duration_s, repair_amount, status)
       VALUES ($1, $2, 'repair', 10, 5, 5, 10, 60, 25, 'active')
       RETURNING task_id`,
      [regionId, gersId]
    );
    const taskId = taskResult.rows[0].task_id;

    await tx.query(
      `UPDATE crews SET status = 'working', active_task_id = $2, busy_until = now() - interval '1 second' WHERE crew_id = $1`,
      [crewId, taskId]
    );

    // Start with very low rust level
    await tx.query(`UPDATE hex_cells SET rust_level = 0.01 WHERE h3_index = $1`, [hexIndex]);

    const result = await completeFinishedTasks(tx, DAY_MULTIPLIERS);

    // Should clamp to 0, not go negative
    expect(result.rustHexes[0].rust_level).toBe(0);
  });

  it("applies different rust pushback based on phase multipliers", async () => {
    const { regionId, hexIndex, gersId, crewId } = await insertTestFixtures(tx);

    const taskResult = await tx.query<{ task_id: string }>(
      `INSERT INTO tasks (region_id, target_gers_id, task_type, cost_food, cost_equipment, cost_energy, cost_materials, duration_s, repair_amount, status)
       VALUES ($1, $2, 'repair', 10, 5, 5, 10, 60, 25, 'active')
       RETURNING task_id`,
      [regionId, gersId]
    );
    const taskId = taskResult.rows[0].task_id;

    await tx.query(
      `UPDATE crews SET status = 'working', active_task_id = $2, busy_until = now() - interval '1 second' WHERE crew_id = $1`,
      [crewId, taskId]
    );

    await tx.query(`UPDATE hex_cells SET rust_level = 0.5 WHERE h3_index = $1`, [hexIndex]);

    // Night multipliers have rust_spread = 1.0, so pushback = 0.02 * max(0, 1.5 - 1.0) = 0.01
    const result = await completeFinishedTasks(tx, NIGHT_MULTIPLIERS);

    // 0.5 - 0.01 = 0.49
    expect(result.rustHexes[0].rust_level).toBeCloseTo(0.49, 2);
  });

  it("returns empty results when no crews are due", async () => {
    await insertTestFixtures(tx);

    // No tasks or crews set up as 'working'
    const result = await completeFinishedTasks(tx, DAY_MULTIPLIERS);

    expect(result.taskDeltas).toHaveLength(0);
    expect(result.featureDeltas).toHaveLength(0);
    expect(result.rustHexes).toHaveLength(0);
    expect(result.feedItems).toHaveLength(0);
  });

  it("does not complete crews that are still working", async () => {
    const { regionId, gersId, crewId } = await insertTestFixtures(tx);

    const taskResult = await tx.query<{ task_id: string }>(
      `INSERT INTO tasks (region_id, target_gers_id, task_type, cost_food, cost_equipment, cost_energy, cost_materials, duration_s, repair_amount, status)
       VALUES ($1, $2, 'repair', 10, 5, 5, 10, 60, 25, 'active')
       RETURNING task_id`,
      [regionId, gersId]
    );
    const taskId = taskResult.rows[0].task_id;

    // Set busy_until in the future
    await tx.query(
      `UPDATE crews SET status = 'working', active_task_id = $2, busy_until = now() + interval '1 hour' WHERE crew_id = $1`,
      [crewId, taskId]
    );

    const result = await completeFinishedTasks(tx, DAY_MULTIPLIERS);

    expect(result.taskDeltas).toHaveLength(0);

    // Verify crew is still working
    const crewState = await tx.query<{ status: string }>(
      `SELECT status FROM crews WHERE crew_id = $1`,
      [crewId]
    );
    expect(crewState.rows[0].status).toBe("working");
  });

  it("handles multiple crews completing simultaneously", async () => {
    const { regionId, hexIndex } = await insertTestFixtures(tx);

    // Create second road and hex
    const hexIndex2 = "8a2a1072b5affff";
    const gersId2 = "test-road-2";
    const crewId2 = "00000000-0000-0000-0000-000000000002";

    await tx.query(
      `INSERT INTO hex_cells (h3_index, region_id, rust_level, land_ratio, distance_from_center)
       VALUES ($1, $2, 0.3, 1.0, 0)`,
      [hexIndex2, regionId]
    );

    await tx.query(
      `INSERT INTO world_features (gers_id, feature_type, region_id, h3_index, road_class)
       VALUES ($1, 'road', $2, $3, 'tertiary')`,
      [gersId2, regionId, hexIndex2]
    );

    await tx.query(
      `INSERT INTO world_feature_hex_cells (gers_id, h3_index) VALUES ($1, $2)`,
      [gersId2, hexIndex2]
    );

    await tx.query(
      `INSERT INTO feature_state (gers_id, health, status) VALUES ($1, 40, 'degraded')`,
      [gersId2]
    );

    await tx.query(
      `INSERT INTO crews (crew_id, region_id, status) VALUES ($1, $2, 'idle')`,
      [crewId2, regionId]
    );

    // Create tasks for both roads
    const task1Result = await tx.query<{ task_id: string }>(
      `INSERT INTO tasks (region_id, target_gers_id, task_type, cost_food, cost_equipment, cost_energy, cost_materials, duration_s, repair_amount, status)
       VALUES ($1, 'test-road-1', 'repair', 10, 5, 5, 10, 60, 30, 'active')
       RETURNING task_id`,
      [regionId]
    );

    const task2Result = await tx.query<{ task_id: string }>(
      `INSERT INTO tasks (region_id, target_gers_id, task_type, cost_food, cost_equipment, cost_energy, cost_materials, duration_s, repair_amount, status)
       VALUES ($1, $2, 'repair', 10, 5, 5, 10, 60, 20, 'active')
       RETURNING task_id`,
      [regionId, gersId2]
    );

    // Set both crews to 'working' with busy_until in the past
    await tx.query(
      `UPDATE crews SET status = 'working', active_task_id = $1, busy_until = now() - interval '1 second'
       WHERE crew_id = '00000000-0000-0000-0000-000000000001'`,
      [task1Result.rows[0].task_id]
    );

    await tx.query(
      `UPDATE crews SET status = 'working', active_task_id = $2, busy_until = now() - interval '1 second'
       WHERE crew_id = $1`,
      [crewId2, task2Result.rows[0].task_id]
    );

    // Set initial states
    await tx.query(`UPDATE feature_state SET health = 50, status = 'degraded' WHERE gers_id = 'test-road-1'`);
    await tx.query(`UPDATE hex_cells SET rust_level = 0.5 WHERE h3_index = $1`, [hexIndex]);

    const result = await completeFinishedTasks(tx, DAY_MULTIPLIERS);

    // Both tasks should complete
    expect(result.taskDeltas).toHaveLength(2);
    expect(result.featureDeltas).toHaveLength(2);
    expect(result.rustHexes).toHaveLength(2);
    expect(result.feedItems).toHaveLength(2);

    // Verify both crews are idle
    const crewStates = await tx.query<{ crew_id: string; status: string }>(
      `SELECT crew_id, status FROM crews WHERE region_id = $1 ORDER BY crew_id`,
      [regionId]
    );
    expect(crewStates.rows).toHaveLength(2);
    expect(crewStates.rows.every((c) => c.status === "idle")).toBe(true);
  });

  it("handles road spanning multiple hex cells", async () => {
    const { regionId, gersId, crewId } = await insertTestFixtures(tx);

    // Add a second hex cell for the same road
    const hexIndex2 = "8a2a1072b5bffff";
    await tx.query(
      `INSERT INTO hex_cells (h3_index, region_id, rust_level, land_ratio, distance_from_center)
       VALUES ($1, $2, 0.7, 1.0, 0)`,
      [hexIndex2, regionId]
    );

    await tx.query(
      `INSERT INTO world_feature_hex_cells (gers_id, h3_index) VALUES ($1, $2)`,
      [gersId, hexIndex2]
    );

    const taskResult = await tx.query<{ task_id: string }>(
      `INSERT INTO tasks (region_id, target_gers_id, task_type, cost_food, cost_equipment, cost_energy, cost_materials, duration_s, repair_amount, status)
       VALUES ($1, $2, 'repair', 10, 5, 5, 10, 60, 25, 'active')
       RETURNING task_id`,
      [regionId, gersId]
    );
    const taskId = taskResult.rows[0].task_id;

    await tx.query(
      `UPDATE crews SET status = 'working', active_task_id = $2, busy_until = now() - interval '1 second' WHERE crew_id = $1`,
      [crewId, taskId]
    );

    // Set rust levels on both hexes
    await tx.query(`UPDATE hex_cells SET rust_level = 0.5 WHERE h3_index = '8a2a1072b59ffff'`);
    await tx.query(`UPDATE hex_cells SET rust_level = 0.7 WHERE h3_index = $1`, [hexIndex2]);

    const result = await completeFinishedTasks(tx, DAY_MULTIPLIERS);

    // Both hex cells should be updated
    expect(result.rustHexes).toHaveLength(2);

    const hexLevels = result.rustHexes.reduce(
      (acc, h) => {
        acc[h.h3_index] = h.rust_level;
        return acc;
      },
      {} as Record<string, number>
    );

    // Both should have pushback applied (0.028 for day multipliers)
    expect(hexLevels["8a2a1072b59ffff"]).toBeCloseTo(0.472, 2);
    expect(hexLevels[hexIndex2]).toBeCloseTo(0.672, 2);
  });
});
