import type { PhaseName } from "./cycle";

export type PhaseMultipliers = {
  rust_spread: number;
  decay: number;
  generation: number;
  repair_speed: number;
};

export const PHASE_MULTIPLIERS: Record<PhaseName, PhaseMultipliers> = {
  dawn: {
    rust_spread: 0.1,
    decay: 0.3,
    generation: 12,
    repair_speed: 1.0
  },
  day: {
    rust_spread: 0.05,
    decay: 0.2,
    generation: 15,
    repair_speed: 1.25
  },
  dusk: {
    rust_spread: 0.25,
    decay: 0.6,
    generation: 8,
    repair_speed: 1.0
  },
  night: {
    rust_spread: 0.5,
    decay: 1.0,
    generation: 3,
    repair_speed: 0.75
  }
};

export function getPhaseMultipliers(phase: PhaseName) {
  return PHASE_MULTIPLIERS[phase];
}

export function applyDemoMultiplier(base: PhaseMultipliers, demoMultiplier: number): PhaseMultipliers {
  if (demoMultiplier <= 1) return base;
  return {
    rust_spread: base.rust_spread * demoMultiplier,
    decay: base.decay * demoMultiplier,
    generation: base.generation * demoMultiplier,
    repair_speed: base.repair_speed * demoMultiplier
  };
}
