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

export type CycleSnapshot = {
  phase: PhaseName;
  phaseStartMs: number;
  phaseProgress: number;
  nextPhase: PhaseName;
  nextPhaseInMs: number;
  cycleStartMs: number;
};

function normalizeElapsed(elapsedMs: number) {
  const modulo = elapsedMs % CYCLE_LENGTH_MS;
  return modulo < 0 ? modulo + CYCLE_LENGTH_MS : modulo;
}

export function computeCycleSnapshot(nowMs: number, cycleStartMs: number): CycleSnapshot {
  const normalizedElapsed = normalizeElapsed(nowMs - cycleStartMs);
  let remaining = normalizedElapsed;

  for (let index = 0; index < PHASES.length; index += 1) {
    const phase = PHASES[index];
    if (remaining < phase.durationMs) {
      const phaseElapsed = remaining;
      const phaseProgress = phaseElapsed / phase.durationMs;
      const nextPhase = PHASES[(index + 1) % PHASES.length].name;
      const cycleStartNormalized = nowMs - normalizedElapsed;

      return {
        phase: phase.name,
        phaseStartMs: nowMs - phaseElapsed,
        phaseProgress,
        nextPhase,
        nextPhaseInMs: phase.durationMs - phaseElapsed,
        cycleStartMs: cycleStartNormalized
      };
    }

    remaining -= phase.durationMs;
  }

  const fallbackPhase = PHASES[0];
  return {
    phase: fallbackPhase.name,
    phaseStartMs: nowMs,
    phaseProgress: 0,
    nextPhase: PHASES[1].name,
    nextPhaseInMs: fallbackPhase.durationMs,
    cycleStartMs: nowMs
  };
}
