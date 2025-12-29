/**
 * Shared constants used across API routes
 */

export const LAMBDA = 0.1;
export const CONTRIBUTION_LIMIT = 40000;
export const TAX_MULTIPLIER = 0.8;
export const MAX_CLIENT_ID_LENGTH = 64;
export const MAX_DISPLAY_NAME_LENGTH = 32;
export const MAX_REGION_ID_LENGTH = 64;
export const MAX_RESOURCE_VALUE = 1_000_000; // Prevent overflow/storage issues

export const FEATURE_TYPES = new Set(["road", "building", "park", "water", "intersection"]);

// Resource generation categories by building type
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
];

export const EQUIPMENT_CATEGORIES = [
  "hardware",
  "home_improvement",
  "automotive_repair",
  "auto_body_shop",
  "tool_rental",
  "machine_shop"
];

export const ENERGY_CATEGORIES = [
  "industrial",
  "factory",
  "power_plant",
  "solar",
  "wind",
  "utility",
  "electric"
];

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
];

// Building activation - re-exported from shared config
export { BUILDING_ACTIVATION_MS } from "@nightfall/config";

// Minigame configuration
export const MINIGAME_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
export const BASE_BOOST_DURATION_MS = 3 * 60 * 1000; // 3 minutes base
export const QUICK_MODE_ROUNDS = 1; // Quick activation requires just 1 round

// Minigame modes
export type MinigameMode = "quick" | "boost";

// Minigame types by resource (see TODO.md for additional game ideas)
export const FOOD_MINIGAMES = ["kitchen_rush", "fresh_check"];
export const EQUIPMENT_MINIGAMES = ["gear_up", "patch_job"];
export const ENERGY_MINIGAMES = ["power_up"];
export const MATERIALS_MINIGAMES = ["crane_drop"];

// Max possible scores by minigame type (for anti-cheat)
export const MINIGAME_CONFIG: Record<string, { maxScore: number; expectedDurationMs: number; baseRounds: number }> = {
  kitchen_rush: { maxScore: 1000, expectedDurationMs: 30000, baseRounds: 6 },
  fresh_check: { maxScore: 1000, expectedDurationMs: 25000, baseRounds: 20 },
  gear_up: { maxScore: 1000, expectedDurationMs: 20000, baseRounds: 5 },
  patch_job: { maxScore: 1000, expectedDurationMs: 25000, baseRounds: 3 },
  power_up: { maxScore: 1000, expectedDurationMs: 20000, baseRounds: 3 },
  crane_drop: { maxScore: 1000, expectedDurationMs: 25000, baseRounds: 8 },
};

// Road repair minigame configuration
export const REPAIR_MINIGAME_TYPES = ["pothole_patrol", "road_roller", "traffic_director"] as const;

export const REPAIR_MINIGAME_CONFIG: Record<string, { maxScore: number; expectedDurationMs: number; baseRounds: number }> = {
  pothole_patrol: { maxScore: 1000, expectedDurationMs: 20000, baseRounds: 5 },
  road_roller: { maxScore: 1000, expectedDurationMs: 25000, baseRounds: 3 },
  traffic_director: { maxScore: 1000, expectedDurationMs: 25000, baseRounds: 8 },
};

// Minimum performance required to successfully repair (60% = decent but not perfect)
export const REPAIR_SUCCESS_THRESHOLD = 0.6;
