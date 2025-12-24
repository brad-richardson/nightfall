import type { Logger, PoolLike } from "./ticker";
import { computeCycleSnapshot } from "./cycle";
import { notifyEvent } from "./notify";

type CycleRow = {
  cycle_start: string | null;
  phase: string | null;
  phase_start: string | null;
};

function parseDate(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export async function syncCycleState(pool: PoolLike, logger: Logger, now = new Date()) {
  const result = await pool.query<CycleRow>(
    "SELECT value->>'cycle_start' as cycle_start, value->>'phase' as phase, value->>'phase_start' as phase_start FROM world_meta WHERE key = 'cycle_state'"
  );
  const row = result.rows[0];
  const nowMs = now.getTime();
  const parsedCycleStart = parseDate(row?.cycle_start ?? null);
  const cycleStartMs = parsedCycleStart ?? nowMs;

  const snapshot = computeCycleSnapshot(nowMs, cycleStartMs);
  const storedPhase = row?.phase ?? null;
  const shouldUpdate =
    !row ||
    storedPhase !== snapshot.phase ||
    !row.cycle_start ||
    !row.phase_start ||
    parsedCycleStart === null;

  if (storedPhase && storedPhase !== snapshot.phase) {
    logger.info("[ticker] phase change", { from: storedPhase, to: snapshot.phase });

    await notifyEvent(pool, "phase_change", {
      phase: snapshot.phase,
      next_phase: snapshot.nextPhase,
      next_phase_in_seconds: Math.round(snapshot.nextPhaseInMs / 1000)
    });
  }

  if (shouldUpdate) {
    await pool.query(
      `
      INSERT INTO world_meta (key, value, updated_at)
      VALUES (
        'cycle_state',
        jsonb_build_object(
          'phase', $1,
          'phase_start', $2,
          'cycle_start', $3
        ),
        now()
      )
      ON CONFLICT (key)
      DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = now()
      `,
      [
        snapshot.phase,
        new Date(snapshot.phaseStartMs).toISOString(),
        new Date(snapshot.cycleStartMs).toISOString()
      ]
    );
  }

  return snapshot;
}
