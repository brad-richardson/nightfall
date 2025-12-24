import { calculatePhase, getNextPhase } from "./utils/phase";

export type CycleSummary = {
  phase: "dawn" | "day" | "dusk" | "night";
  phase_progress: number;
  next_phase_in_seconds: number;
};

export type CycleState = CycleSummary & {
  next_phase: "dawn" | "day" | "dusk" | "night";
  phase_start: string;
};

type PoolLike = {
  query: <T = unknown>(text: string, params?: unknown[]) => Promise<{ rows: T[] }>;
};

type CycleRow = {
  cycle_start: string | null;
  phase_start: string | null;
};

function parseDate(value: string | null, fallback: Date) {
  if (!value) {
    return fallback;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return new Date(parsed);
}

export async function loadCycleState(pool: PoolLike, now = new Date()): Promise<CycleState> {
  const result = await pool.query<CycleRow>(
    "SELECT value->>'cycle_start' as cycle_start, value->>'phase_start' as phase_start FROM world_meta WHERE key = 'cycle_state'"
  );

  const row = result.rows[0];
  const cycleStart = parseDate(row?.cycle_start ?? null, now);
  const phaseStart = parseDate(row?.phase_start ?? null, now);
  const phaseState = calculatePhase(cycleStart, now);

  return {
    phase: phaseState.phase,
    phase_progress: phaseState.phase_progress,
    next_phase_in_seconds: phaseState.next_phase_in_seconds,
    next_phase: getNextPhase(phaseState.phase),
    phase_start: phaseStart.toISOString()
  };
}

export async function loadCycleSummary(pool: PoolLike, now = new Date()): Promise<CycleSummary> {
  const cycle = await loadCycleState(pool, now);
  return {
    phase: cycle.phase,
    phase_progress: cycle.phase_progress,
    next_phase_in_seconds: cycle.next_phase_in_seconds
  };
}
