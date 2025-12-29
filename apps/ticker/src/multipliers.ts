// Re-export phase multipliers from shared config for single source of truth
export {
  type PhaseName,
  type PhaseMultipliers,
  PHASE_MULTIPLIERS,
  getPhaseMultipliers
} from "@nightfall/config";

export function applyDemoMultiplier(base: import("@nightfall/config").PhaseMultipliers, demoMultiplier: number): import("@nightfall/config").PhaseMultipliers {
  if (demoMultiplier <= 1) return base;
  return {
    rust_spread: base.rust_spread * demoMultiplier,
    decay: base.decay * demoMultiplier,
    generation: base.generation * demoMultiplier,
    repair_speed: base.repair_speed * demoMultiplier
  };
}
