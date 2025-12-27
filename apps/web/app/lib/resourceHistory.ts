/**
 * Resource history tracking for trendline visualization.
 * Stores historical resource pool values in memory with timestamps.
 */

export type ResourceType = "food" | "equipment" | "energy" | "materials";

export type HistoryPoint = {
  value: number;
  timestamp: number;
};

export type ResourceHistory = {
  food: HistoryPoint[];
  equipment: HistoryPoint[];
  energy: HistoryPoint[];
  materials: HistoryPoint[];
};

// Maximum number of history points to retain (roughly 10 minutes at 5-second intervals)
const MAX_HISTORY_POINTS = 120;

// Minimum interval between history points in milliseconds (5 seconds)
const MIN_INTERVAL_MS = 5000;

// In-memory history storage (not persisted to localStorage)
let history: ResourceHistory = {
  food: [],
  equipment: [],
  energy: [],
  materials: []
};

let lastRecordedAt = 0;

/**
 * Record current resource pool values to history
 */
export function recordResourceValues(pools: {
  pool_food: number;
  pool_equipment: number;
  pool_energy: number;
  pool_materials: number;
}): void {
  const now = Date.now();

  // Throttle to avoid too many data points
  if (now - lastRecordedAt < MIN_INTERVAL_MS) {
    return;
  }
  lastRecordedAt = now;

  const addPoint = (type: ResourceType, value: number) => {
    history[type].push({ value, timestamp: now });
    // Keep only the most recent points
    if (history[type].length > MAX_HISTORY_POINTS) {
      history[type] = history[type].slice(-MAX_HISTORY_POINTS);
    }
  };

  addPoint("food", pools.pool_food);
  addPoint("equipment", pools.pool_equipment);
  addPoint("energy", pools.pool_energy);
  addPoint("materials", pools.pool_materials);
}

/**
 * Get history for a specific resource type
 */
export function getResourceHistory(type: ResourceType): HistoryPoint[] {
  return history[type];
}

/**
 * Get all resource history
 */
export function getAllResourceHistory(): ResourceHistory {
  return history;
}

/**
 * Calculate trend statistics for a resource
 */
export function getResourceTrend(type: ResourceType): {
  current: number;
  change: number;
  changePercent: number;
  trend: "up" | "down" | "stable";
  min: number;
  max: number;
} {
  const points = history[type];

  if (points.length === 0) {
    return {
      current: 0,
      change: 0,
      changePercent: 0,
      trend: "stable",
      min: 0,
      max: 0
    };
  }

  const current = points[points.length - 1].value;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);

  // Compare to value from ~1 minute ago (or earliest available)
  const oneMinuteAgo = Date.now() - 60000;
  const comparePoint =
    points.find((p) => p.timestamp >= oneMinuteAgo) || points[0];
  const change = current - comparePoint.value;
  const changePercent =
    comparePoint.value > 0 ? (change / comparePoint.value) * 100 : 0;

  // Use proportional threshold: 1% of current value or minimum of 5
  // This scales better across different resource magnitudes
  const threshold = Math.max(5, current * 0.01);
  let trend: "up" | "down" | "stable" = "stable";
  if (change > threshold) trend = "up";
  else if (change < -threshold) trend = "down";

  return {
    current,
    change,
    changePercent,
    trend,
    min,
    max
  };
}

/**
 * Clear all history (useful for testing or region changes)
 */
export function clearResourceHistory(): void {
  history = {
    food: [],
    equipment: [],
    energy: [],
    materials: []
  };
  lastRecordedAt = 0;
}
