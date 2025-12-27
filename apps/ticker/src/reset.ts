import type { PoolLike } from "./ticker";
import { notifyEvent } from "./notify";
import { logger } from "./logger";

export async function performWeeklyReset(client: PoolLike) {
  logger.info("[reset] starting weekly reset");

  try {
    // 1. Reset road health (70-90 random)
    await client.query(`
      UPDATE feature_state 
      SET health = 70 + floor(random() * 21),
          status = 'normal',
          updated_at = now()
      WHERE gers_id IN (SELECT gers_id FROM world_features WHERE feature_type = 'road')
    `);

    // 2. Clear Rust (outer = 0.3, inner = 0)
    // We need max distance first
    const maxDistResult = await client.query<{ max_dist: number }>(
      "SELECT MAX(distance_from_center) as max_dist FROM regions"
    );
    const maxDist = maxDistResult.rows[0]?.max_dist || 1;

    await client.query(`
      UPDATE hex_cells
      SET rust_level = LEAST(0.3, distance_from_center / $1 * 0.3),
          updated_at = now()
    `, [maxDist]);

    // 3. Reset region pools
    await client.query(`
      UPDATE regions
      SET pool_food = 2000,
          pool_equipment = 2000,
          pool_energy = 2000,
          pool_materials = 2000,
          updated_at = now()
    `);

    // 4. Clear tasks
    await client.query("DELETE FROM tasks WHERE status IN ('queued', 'active')");
    await client.query("TRUNCATE TABLE task_votes");

    // 5. Reset crews
    await client.query(`
      UPDATE crews 
      SET status = 'idle', 
          active_task_id = NULL, 
          busy_until = NULL
    `);

    // 6. Update world_meta
    const versionResult = await client.query<{ version: number }>(
      "SELECT value->>'version' as version FROM world_meta WHERE key = 'last_reset'"
    );
    const newVersion = Number(versionResult.rows[0]?.version || 0) + 1;

    await client.query(`
      INSERT INTO world_meta (key, value, updated_at)
      VALUES (
        'last_reset',
        jsonb_build_object('ts', now(), 'version', $1),
        now()
      )
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = now()
    `, [newVersion]);

    // Reset cycle to dawn
    await client.query(`
      INSERT INTO world_meta (key, value, updated_at)
      VALUES (
        'cycle_state',
        jsonb_build_object(
          'phase', 'dawn',
          'phase_start', now(),
          'cycle_start', now()
        ),
        now()
      )
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = now()
    `);

    // 7. Log event and notify
    await notifyEvent(client, "reset", { world_version: newVersion });
    
    await client.query(
      "INSERT INTO events (event_type, payload) VALUES ('world_reset', $1)",
      [JSON.stringify({ version: newVersion })]
    );

    logger.info({ newVersion }, "[reset] weekly reset complete");

  } catch (error) {
    logger.error({ err: error }, "[reset] failed to perform reset");
    throw error;
  }
}

export async function checkAndPerformReset(client: PoolLike) {
  const result = await client.query<{ value: boolean }>(
    "SELECT value::boolean as value FROM world_meta WHERE key = 'pending_reset'"
  );

  if (result.rows[0]?.value) {
    await performWeeklyReset(client);
    // Clear the pending flag
    await client.query("DELETE FROM world_meta WHERE key = 'pending_reset'");
  }
}
