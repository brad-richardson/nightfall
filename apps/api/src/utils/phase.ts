export type Phase = "dawn" | "day" | "dusk" | "night";

export type PhaseMultipliers = {
  rust_spread: number;
  decay: number;
  generation: number;
  repair_speed: number;
};

export type CycleState = {
  phase: Phase;
  phase_progress: number;
  next_phase_in_seconds: number;
  multipliers: PhaseMultipliers;
};

// Phase durations in seconds (20-minute full cycle)
export const PHASE_DURATIONS: Record<Phase, number> = {
  dawn: 2 * 60, // 2 minutes
  day: 8 * 60, // 8 minutes
  dusk: 2 * 60, // 2 minutes
  night: 8 * 60 // 8 minutes
};

export const CYCLE_DURATION_SECONDS =
  PHASE_DURATIONS.dawn +
  PHASE_DURATIONS.day +
  PHASE_DURATIONS.dusk +
  PHASE_DURATIONS.night;

// Phase multipliers from spec
export const PHASE_MULTIPLIERS: Record<Phase, PhaseMultipliers> = {
  dawn: {
    rust_spread: 0.2, // Rust spreads slowly
    decay: 0.3, // Roads decay slowly
    generation: 1.2, // Resource generation bonus (people waking up)
    repair_speed: 1.0 // Normal repair speed
  },
  day: {
    rust_spread: 0.1, // Rust barely spreads
    decay: 0.2, // Minimal decay
    generation: 1.5, // Peak generation
    repair_speed: 1.25 // Crews work faster in daylight
  },
  dusk: {
    rust_spread: 0.5, // Rust picking up
    decay: 0.6, // Decay increasing
    generation: 0.8, // Generation winding down
    repair_speed: 1.0 // Normal repair speed
  },
  night: {
    rust_spread: 1.0, // Full Rust spread
    decay: 1.0, // Full decay rate
    generation: 0.3, // Minimal generation (skeleton crews)
    repair_speed: 0.75 // Crews work slower at night
  }
};

// Phase order for cycling
const PHASE_ORDER: Phase[] = ["dawn", "day", "dusk", "night"];

/**
 * Calculate the current phase of the day/night cycle.
 *
 * @param cycleStartedAt - When the current cycle started (from world_meta)
 * @param now - Current time (defaults to Date.now())
 * @returns Current cycle state including phase, progress, and multipliers
 */
export function calculatePhase(
  cycleStartedAt: Date,
  now: Date = new Date()
): CycleState {
  const elapsedMs = now.getTime() - cycleStartedAt.getTime();
  const elapsedSeconds = Math.floor(elapsedMs / 1000);

  // Handle negative elapsed time (cycle hasn't started yet)
  if (elapsedSeconds < 0) {
    return {
      phase: "dawn",
      phase_progress: 0,
      next_phase_in_seconds: Math.abs(elapsedSeconds) + PHASE_DURATIONS.dawn,
      multipliers: PHASE_MULTIPLIERS.dawn
    };
  }

  // Position within the current cycle (cycles repeat)
  const positionInCycle = elapsedSeconds % CYCLE_DURATION_SECONDS;

  // Find which phase we're in
  let accumulatedSeconds = 0;
  for (const phase of PHASE_ORDER) {
    const phaseDuration = PHASE_DURATIONS[phase];
    const phaseEnd = accumulatedSeconds + phaseDuration;

    if (positionInCycle < phaseEnd) {
      const secondsIntoPhase = positionInCycle - accumulatedSeconds;
      const progress = secondsIntoPhase / phaseDuration;
      const remainingSeconds = phaseDuration - secondsIntoPhase;

      return {
        phase,
        phase_progress: Math.min(1, Math.max(0, progress)),
        next_phase_in_seconds: Math.ceil(remainingSeconds),
        multipliers: PHASE_MULTIPLIERS[phase]
      };
    }

    accumulatedSeconds = phaseEnd;
  }

  // Fallback (should never reach here)
  return {
    phase: "dawn",
    phase_progress: 0,
    next_phase_in_seconds: PHASE_DURATIONS.dawn,
    multipliers: PHASE_MULTIPLIERS.dawn
  };
}

/**
 * Get the next phase in the cycle.
 */
export function getNextPhase(current: Phase): Phase {
  const index = PHASE_ORDER.indexOf(current);
  return PHASE_ORDER[(index + 1) % PHASE_ORDER.length];
}
