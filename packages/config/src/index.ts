export type Bbox = {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
};

export type RegionConfig = {
  regionId: string;
  regionName: string;
  bbox: Bbox;
  /** Difficulty multiplier for decay rate. Default is 1.0. Higher = harder (faster decay) */
  difficultyMultiplier?: number;
};

export const BOSTON_BBOX: Bbox = {
  xmin: -71.1912,
  ymin: 42.2279,
  xmax: -70.9201,
  ymax: 42.3974,
};

export const BAR_HARBOR_DEMO_BBOX: Bbox = {
  xmin: -68.30,
  ymin: 44.35,
  xmax: -68.20,
  ymax: 44.42,
};

export const H3_RESOLUTION = 7;

// Roads are considered "degraded" when health falls below this threshold
export const DEGRADED_HEALTH_THRESHOLD = 70;

// Roads show as RED (severely damaged) when health falls to or below this threshold
export const CRITICAL_HEALTH_THRESHOLD = 30;

// Health bucket size for SSE delta filtering (only emit when crossing a bucket boundary)
export const HEALTH_BUCKET_SIZE = 10;

export type ResourceType = "food" | "equipment" | "energy" | "materials";

export const RESOURCE_TYPES: ResourceType[] = ["food", "equipment", "energy", "materials"];

export type RoadClassInfo = {
  decayRate: number;
  /** Base cost for all resource types (same for food, equipment, energy, materials) */
  baseCost: number;
  /** Maximum +/- offset from baseCost (actual cost = baseCost + offset where offset is in [-costVariance, +costVariance]) */
  costVariance: number;
  durationS: number;
  repairAmount: number;
  priorityWeight: number;
};

export const ROAD_CLASSES: Record<string, RoadClassInfo> = {
  motorway: {
    decayRate: 0.5,
    baseCost: 35,
    costVariance: 14, // range: 21-49
    durationS: 8,
    repairAmount: 30,
    priorityWeight: 10
  },
  trunk: {
    decayRate: 0.6,
    baseCost: 29,
    costVariance: 12, // range: 17-41
    durationS: 7,
    repairAmount: 30,
    priorityWeight: 8
  },
  primary: {
    decayRate: 0.8,
    baseCost: 22,
    costVariance: 8, // range: 14-30
    durationS: 6,
    repairAmount: 25,
    priorityWeight: 6
  },
  secondary: {
    decayRate: 1.0,
    baseCost: 15,
    costVariance: 6, // range: 9-21
    durationS: 5,
    repairAmount: 25,
    priorityWeight: 4
  },
  tertiary: {
    decayRate: 1.2,
    baseCost: 12,
    costVariance: 5, // range: 7-17
    durationS: 4,
    repairAmount: 20,
    priorityWeight: 3
  },
  residential: {
    decayRate: 1.5,
    baseCost: 8,
    costVariance: 3, // range: 5-11
    durationS: 3,
    repairAmount: 20,
    priorityWeight: 2
  },
  service: {
    decayRate: 2.0,
    baseCost: 4,
    costVariance: 1, // range: 3-5
    durationS: 3,
    repairAmount: 15,
    priorityWeight: 1
  }
};

// Validate road class names are safe for SQL interpolation (defense in depth)
const VALID_ROAD_CLASS = /^[a-z_]+$/;
Object.keys(ROAD_CLASSES).forEach(cls => {
  if (!VALID_ROAD_CLASS.test(cls)) {
    throw new Error(`Invalid road class name: ${cls}. Must match /^[a-z_]+$/`);
  }
});

export const ROAD_CLASS_FILTER = Object.keys(ROAD_CLASSES);

export const REGION_CONFIGS: Record<string, RegionConfig> = {
  boston_ma_usa: {
    regionId: "boston_ma_usa",
    regionName: "Boston, MA, USA",
    bbox: BOSTON_BBOX,
    difficultyMultiplier: 1.0
  },
  bar_harbor_me_usa_demo: {
    regionId: "bar_harbor_me_usa_demo",
    regionName: "Bar Harbor, ME, USA (Demo)",
    bbox: BAR_HARBOR_DEMO_BBOX,
    // Demo region is harder to make the small area more challenging
    difficultyMultiplier: 2.5
  }
};

/**
 * Calculate city resilience score from health and rust levels.
 * Score = health × (1 - rust), so high rust directly reduces score.
 * Range: 0-100
 *
 * @param healthAvg - Average road health (0-100), null treated as 0
 * @param rustAvg - Average rust level (0-1), null treated as 0
 * @returns Integer score from 0-100
 */
export function calculateCityScore(healthAvg: number | null, rustAvg: number | null): number {
  const health = Math.max(0, Math.min(100, healthAvg ?? 0));
  const rust = Math.max(0, Math.min(1, rustAvg ?? 0));
  return Math.round(health * (1 - rust));
}

/**
 * City status thresholds and labels based on resilience score.
 * Each status has a minimum score threshold and associated styling.
 */
export type CityStatus = "thriving" | "stable" | "struggling" | "critical" | "collapse";

export type CityStatusConfig = {
  label: string;
  minScore: number;
  color: string;
};

export const CITY_STATUS_THRESHOLDS: Record<CityStatus, CityStatusConfig> = {
  thriving: { label: "Thriving", minScore: 80, color: "#22c55e" },   // green-500
  stable: { label: "Stable", minScore: 60, color: "#84cc16" },       // lime-500
  struggling: { label: "Struggling", minScore: 40, color: "#eab308" }, // yellow-500
  critical: { label: "Critical", minScore: 20, color: "#f97316" },   // orange-500
  collapse: { label: "Collapse", minScore: 0, color: "#ef4444" }     // red-500
};

/**
 * Get city status based on resilience score
 */
export function getCityStatus(score: number): CityStatus {
  if (score >= 80) return "thriving";
  if (score >= 60) return "stable";
  if (score >= 40) return "struggling";
  if (score >= 20) return "critical";
  return "collapse";
}

/**
 * Get status label for a given score
 */
export function getCityStatusLabel(score: number): string {
  return CITY_STATUS_THRESHOLDS[getCityStatus(score)].label;
}

/**
 * Get status color for a given score
 */
export function getCityStatusColor(score: number): string {
  return CITY_STATUS_THRESHOLDS[getCityStatus(score)].color;
}

// =============================================================================
// Player Scoring & Tier System
// =============================================================================

/**
 * Player tier definitions with thresholds and rewards.
 * Score is accumulated from player actions (resource contributions, voting, etc.)
 */
export type PlayerTier = "newcomer" | "contributor" | "builder" | "engineer" | "architect" | "legend";

export type TierConfig = {
  label: string;
  minScore: number;
  color: string;
  badgeIcon: string; // Emoji for display
  resourceBonus: number; // Multiplier for resource contributions (e.g., 1.05 = 5% bonus)
  transferSpeedBonus: number; // Multiplier for transfer speed (e.g., 1.1 = 10% faster)
  emergencyRepairCharges: number; // Number of emergency repair deploys available per day
};

export const PLAYER_TIERS: Record<PlayerTier, TierConfig> = {
  newcomer: {
    label: "Newcomer",
    minScore: 0,
    color: "#9ca3af", // gray-400
    badgeIcon: "🔰",
    resourceBonus: 1.0,
    transferSpeedBonus: 1.0,
    emergencyRepairCharges: 0
  },
  contributor: {
    label: "Contributor",
    minScore: 100,
    color: "#22c55e", // green-500
    badgeIcon: "⚡",
    resourceBonus: 1.05, // 5% bonus
    transferSpeedBonus: 1.0,
    emergencyRepairCharges: 0
  },
  builder: {
    label: "Builder",
    minScore: 500,
    color: "#3b82f6", // blue-500
    badgeIcon: "🔧",
    resourceBonus: 1.10, // 10% bonus
    transferSpeedBonus: 1.05, // 5% faster
    emergencyRepairCharges: 1
  },
  engineer: {
    label: "Engineer",
    minScore: 2000,
    color: "#8b5cf6", // violet-500
    badgeIcon: "⚙️",
    resourceBonus: 1.15, // 15% bonus
    transferSpeedBonus: 1.10, // 10% faster
    emergencyRepairCharges: 2
  },
  architect: {
    label: "Architect",
    minScore: 10000,
    color: "#f59e0b", // amber-500
    badgeIcon: "🏗️",
    resourceBonus: 1.20, // 20% bonus
    transferSpeedBonus: 1.15, // 15% faster
    emergencyRepairCharges: 3
  },
  legend: {
    label: "Legend",
    minScore: 50000,
    color: "#ef4444", // red-500
    badgeIcon: "🌟",
    resourceBonus: 1.25, // 25% bonus
    transferSpeedBonus: 1.20, // 20% faster
    emergencyRepairCharges: 5
  }
};

// Ordered list for tier progression
export const TIER_ORDER: PlayerTier[] = ["newcomer", "contributor", "builder", "engineer", "architect", "legend"];

/**
 * Get player tier based on score
 */
export function getPlayerTier(score: number): PlayerTier {
  // Iterate in reverse to find the highest tier the player qualifies for
  for (let i = TIER_ORDER.length - 1; i >= 0; i--) {
    const tier = TIER_ORDER[i];
    if (score >= PLAYER_TIERS[tier].minScore) {
      return tier;
    }
  }
  return "newcomer";
}

/**
 * Get tier config for a given score
 */
export function getPlayerTierConfig(score: number): TierConfig {
  return PLAYER_TIERS[getPlayerTier(score)];
}

/**
 * Calculate progress to next tier (0-1)
 */
export function getTierProgress(score: number): { currentTier: PlayerTier; nextTier: PlayerTier | null; progress: number; scoreToNext: number } {
  const currentTier = getPlayerTier(score);
  const currentIndex = TIER_ORDER.indexOf(currentTier);

  if (currentIndex === TIER_ORDER.length - 1) {
    // Already at max tier
    return { currentTier, nextTier: null, progress: 1, scoreToNext: 0 };
  }

  const nextTier = TIER_ORDER[currentIndex + 1];
  const currentThreshold = PLAYER_TIERS[currentTier].minScore;
  const nextThreshold = PLAYER_TIERS[nextTier].minScore;
  const range = nextThreshold - currentThreshold;
  const progressInRange = score - currentThreshold;

  return {
    currentTier,
    nextTier,
    progress: Math.min(1, progressInRange / range),
    scoreToNext: nextThreshold - score
  };
}

/**
 * Score values for different player actions
 */
export const SCORE_ACTIONS = {
  resourceContribution: 1, // Per unit of resource contributed
  voteSubmitted: 5, // Per vote on a task
  minigameCompleted: 10, // Base score for completing a minigame
  minigamePerfect: 25, // Bonus for perfect minigame performance
  taskCompleted: 50 // When a task the player voted on is completed
} as const;

// =============================================================================
// Building Activation
// =============================================================================

/**
 * Duration in milliseconds that a building remains activated after activation.
 * During this time, the building will auto-generate convoys to the regional hub.
 */
export const BUILDING_ACTIVATION_MS = 2 * 60 * 1000; // 2 minutes

// =============================================================================
// Resource Generation Categories
// =============================================================================
// These patterns are used to determine what resource type a building generates
// based on its Overture Maps place_category field.

export const FOOD_CATEGORIES = [
  "restaurant",
  "cafe",
  "bar",
  "food",
  "grocery",
  "supermarket",
  "bakery",
  "deli",
  "farm",
  "farmers_market"
] as const;

export const EQUIPMENT_CATEGORIES = [
  "hardware",
  "home_improvement",
  "automotive_repair",
  "auto_body_shop",
  "tool_rental",
  "machine_shop"
] as const;

export const ENERGY_CATEGORIES = [
  "industrial",
  "factory",
  "power_plant",
  "solar",
  "wind",
  "utility",
  "electric"
] as const;

export const MATERIALS_CATEGORIES = [
  "construction",
  "building_supply",
  "lumber",
  "wood",
  "flooring",
  "warehouse",
  "manufacturing",
  "garden_center",
  "nursery_and_gardening"
] as const;

// =============================================================================
// Day/Night Cycle Phase Multipliers
// =============================================================================

export type PhaseName = "dawn" | "day" | "dusk" | "night";

export type PhaseMultipliers = {
  rust_spread: number;
  decay: number;
  generation: number;
  repair_speed: number;
};

/**
 * Multipliers that vary based on the current day/night cycle phase.
 * - dawn: Rust retreats, moderate generation
 * - day: Best conditions - low rust/decay, high generation and repair
 * - dusk: Conditions worsen, generation drops
 * - night: Worst conditions - high rust/decay, low generation and repair
 */
export const PHASE_MULTIPLIERS: Record<PhaseName, PhaseMultipliers> = {
  dawn: {
    rust_spread: 0.1,
    decay: 0.12, // -20% from 0.15
    generation: 130,
    repair_speed: 1.0
  },
  day: {
    rust_spread: 0.05,
    decay: 0.08, // -20% from 0.1
    generation: 150,
    repair_speed: 1.25
  },
  dusk: {
    rust_spread: 0.25,
    decay: 0.2, // -33% from 0.3
    generation: 105,
    repair_speed: 1.0
  },
  night: {
    rust_spread: 0.5,
    decay: 0.35, // -30% from 0.5
    generation: 80,
    repair_speed: 0.75
  }
};

export function getPhaseMultipliers(phase: PhaseName): PhaseMultipliers {
  return PHASE_MULTIPLIERS[phase];
}
