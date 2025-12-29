/**
 * Shared resource constants for colors and emojis
 * Used across resource pools, tooltips, and map features
 */

export const RESOURCE_CONFIG = {
  food: {
    color: "#4ade80", // green-400
    emoji: "🍎",
    label: "Food"
  },
  equipment: {
    color: "#f97316", // orange-500
    emoji: "🔧",
    label: "Equipment"
  },
  energy: {
    color: "#facc15", // yellow-400
    emoji: "⚡",
    label: "Energy"
  },
  materials: {
    color: "#818cf8", // indigo-400
    emoji: "🪵",
    label: "Materials"
  }
} as const;

export type ResourceType = keyof typeof RESOURCE_CONFIG;

// Extract just colors for backward compatibility
export const RESOURCE_COLORS = {
  food: RESOURCE_CONFIG.food.color,
  equipment: RESOURCE_CONFIG.equipment.color,
  energy: RESOURCE_CONFIG.energy.color,
  materials: RESOURCE_CONFIG.materials.color
} as const;

// Extract just emojis
export const RESOURCE_EMOJIS = {
  food: RESOURCE_CONFIG.food.emoji,
  equipment: RESOURCE_CONFIG.equipment.emoji,
  energy: RESOURCE_CONFIG.energy.emoji,
  materials: RESOURCE_CONFIG.materials.emoji
} as const;
