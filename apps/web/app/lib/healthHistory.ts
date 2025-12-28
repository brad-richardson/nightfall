/**
 * Health history tracking for trend visualization.
 * Tracks region health and score over time for trend indicators.
 */

export type HealthPoint = {
  health: number;
  rust: number;
  score: number;
  timestamp: number;
};

// Maximum number of history points (roughly 5 minutes at 5-second intervals)
const MAX_HISTORY_POINTS = 60;

// Minimum interval between history points in milliseconds (5 seconds)
const MIN_INTERVAL_MS = 5000;

// In-memory history storage
let history: HealthPoint[] = [];
let lastRecordedAt = 0;

/**
 * Record current health values to history
 */
export function recordHealthValues(health: number, rust: number, score: number): void {
  const now = Date.now();

  // Throttle to avoid too many data points
  if (now - lastRecordedAt < MIN_INTERVAL_MS) {
    return;
  }
  lastRecordedAt = now;

  history.push({ health, rust, score, timestamp: now });

  // Keep only the most recent points
  if (history.length > MAX_HISTORY_POINTS) {
    history = history.slice(-MAX_HISTORY_POINTS);
  }
}

/**
 * Get health history (returns a copy to prevent external mutations)
 */
export function getHealthHistory(): HealthPoint[] {
  return [...history];
}

/**
 * Calculate health trend statistics
 */
export function getHealthTrend(): {
  currentScore: number;
  scoreChange: number;
  scoreTrend: "up" | "down" | "stable";
  healthChange: number;
  healthTrend: "up" | "down" | "stable";
  rustChange: number;
  rustTrend: "up" | "down" | "stable";
  streak: number;
  streakType: "improving" | "declining" | "stable";
} {
  if (history.length === 0) {
    return {
      currentScore: 0,
      scoreChange: 0,
      scoreTrend: "stable",
      healthChange: 0,
      healthTrend: "stable",
      rustChange: 0,
      rustTrend: "stable",
      streak: 0,
      streakType: "stable"
    };
  }

  const current = history[history.length - 1];

  // Compare to value from ~1 minute ago (or earliest available)
  const oneMinuteAgo = Date.now() - 60000;
  const comparePoint = history.find((p) => p.timestamp >= oneMinuteAgo) || history[0];

  const scoreChange = current.score - comparePoint.score;
  const healthChange = current.health - comparePoint.health;
  const rustChange = current.rust - comparePoint.rust;

  // Determine trends - use consistent threshold of 1 for score changes
  const SCORE_THRESHOLD = 1;
  const scoreTrend = scoreChange > SCORE_THRESHOLD ? "up" : scoreChange < -SCORE_THRESHOLD ? "down" : "stable";
  const healthTrend = healthChange > 0.5 ? "up" : healthChange < -0.5 ? "down" : "stable";
  const rustTrend = rustChange > 0.01 ? "up" : rustChange < -0.01 ? "down" : "stable";

  // Calculate streak (consecutive ticks in same direction)
  // Uses same threshold as scoreTrend for consistency
  let streak = 0;
  let streakType: "improving" | "declining" | "stable" = "stable";

  if (history.length >= 2) {
    // Check recent history for consistent improvement or decline
    for (let i = history.length - 1; i > 0; i--) {
      const diff = history[i].score - history[i - 1].score;
      if (diff > SCORE_THRESHOLD) {
        if (streakType === "stable") streakType = "improving";
        if (streakType === "improving") streak++;
        else break;
      } else if (diff < -SCORE_THRESHOLD) {
        if (streakType === "stable") streakType = "declining";
        if (streakType === "declining") streak++;
        else break;
      } else {
        if (streak === 0) streakType = "stable";
        break;
      }
    }
    // Convert transition count to point count (3 points = 2 transitions = "3 tick streak")
    if (streak > 0) streak++;
  }

  return {
    currentScore: current.score,
    scoreChange,
    scoreTrend,
    healthChange,
    healthTrend,
    rustChange,
    rustTrend,
    streak,
    streakType
  };
}

/**
 * Clear all history (useful for testing or region changes)
 */
export function clearHealthHistory(): void {
  history = [];
  lastRecordedAt = 0;
}
