import type { PhaseName } from "./cycle";

export type PhaseMultipliers = {
  rust_spread: number;
  decay: number;
  generation: number;
  repair_speed: number;
};

export const PHASE_MULTIPLIERS: Record<PhaseName, PhaseMultipliers> = {
  dawn: {
    rust_spread: 0.2,
    decay: 0.3,
    generation: 1.2,
    repair_speed: 1.0
  },
  day: {
    rust_spread: 0.1,
    decay: 0.2,
    generation: 1.5,
    repair_speed: 1.25
  },
  dusk: {
    rust_spread: 0.5,
    decay: 0.6,
    generation: 0.8,
    repair_speed: 1.0
  },
  night: {
    rust_spread: 1.0,
    decay: 1.0,
    generation: 0.3,
    repair_speed: 0.75
  }
};

export function getPhaseMultipliers(phase: PhaseName) {
  return PHASE_MULTIPLIERS[phase];
}
