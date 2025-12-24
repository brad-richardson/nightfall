export type PhaseName = "dawn" | "day" | "dusk" | "night";

type Phase = {
  name: PhaseName;
  durationMs: number;
};

const PHASES: Phase[] = [
  { name: "dawn", durationMs: 2 * 60 * 1000 },
  { name: "day", durationMs: 8 * 60 * 1000 },
  { name: "dusk", durationMs: 2 * 60 * 1000 },
  { name: "night", durationMs: 8 * 60 * 1000 }
];

const CYCLE_LENGTH_MS = PHASES.reduce((sum, phase) => sum + phase.durationMs, 0);

export type CycleSummary = {
  phase: PhaseName;
  phase_progress: number;
  next_phase_in_seconds: number;
};

type CycleSnapshot = {
  phase: PhaseName;
  phaseProgress: number;
  nextPhaseInMs: number;
};

function normalizeElapsed(elapsedMs: number) {
  const modulo = elapsedMs % CYCLE_LENGTH_MS;
  return modulo < 0 ? modulo + CYCLE_LENGTH_MS : modulo;
}

function computeCycleSnapshot(nowMs: number, cycleStartMs: number): CycleSnapshot {
  const normalizedElapsed = normalizeElapsed(nowMs - cycleStartMs);
  let remaining = normalizedElapsed;

  for (const phase of PHASES) {
    if (remaining < phase.durationMs) {
      const phaseElapsed = remaining;
      return {
        phase: phase.name,
        phaseProgress: phaseElapsed / phase.durationMs,
        nextPhaseInMs: phase.durationMs - phaseElapsed
      };
    }
    remaining -= phase.durationMs;
  }

  return {
    phase: "dawn",
    phaseProgress: 0,
    nextPhaseInMs: PHASES[0].durationMs
  };
}

function parseCycleStart(value: string | null, nowMs: number) {
  if (!value) {
    return nowMs;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? nowMs : parsed;
}

type PoolLike = {
  query: <T = unknown>(text: string, params?: unknown[]) => Promise<{ rows: T[] }>;
};

type CycleRow = {
  cycle_start: string | null;
};

export async function loadCycleSummary(pool: PoolLike, now = new Date()): Promise<CycleSummary> {
  const result = await pool.query<CycleRow>(
    "SELECT value->>'cycle_start' as cycle_start FROM world_meta WHERE key = 'cycle_state'"
  );

  const cycleStart = parseCycleStart(result.rows[0]?.cycle_start ?? null, now.getTime());
  const snapshot = computeCycleSnapshot(now.getTime(), cycleStart);

  return {
    phase: snapshot.phase,
    phase_progress: snapshot.phaseProgress,
    next_phase_in_seconds: Math.max(0, Math.round(snapshot.nextPhaseInMs / 1000))
  };
}
