import { describe, expect, it } from "vitest";
import {
  calculatePhase,
  getNextPhase,
  CYCLE_DURATION_SECONDS,
  PHASE_DURATIONS,
  PHASE_MULTIPLIERS
} from "./phase";

describe("phase utility", () => {
  describe("calculatePhase", () => {
    it("returns dawn at cycle start", () => {
      const cycleStart = new Date();
      const result = calculatePhase(cycleStart, cycleStart);

      expect(result.phase).toBe("dawn");
      expect(result.phase_progress).toBe(0);
      expect(result.next_phase_in_seconds).toBe(PHASE_DURATIONS.dawn);
      expect(result.multipliers).toEqual(PHASE_MULTIPLIERS.dawn);
    });

    it("returns day after dawn ends", () => {
      const cycleStart = new Date("2025-01-01T00:00:00Z");
      const afterDawn = new Date("2025-01-01T00:02:00Z"); // 2 minutes later

      const result = calculatePhase(cycleStart, afterDawn);

      expect(result.phase).toBe("day");
      expect(result.phase_progress).toBe(0);
      expect(result.next_phase_in_seconds).toBe(PHASE_DURATIONS.day);
    });

    it("returns dusk after day ends", () => {
      const cycleStart = new Date("2025-01-01T00:00:00Z");
      // Dawn (2 min) + Day (8 min) = 10 minutes
      const afterDay = new Date("2025-01-01T00:10:00Z");

      const result = calculatePhase(cycleStart, afterDay);

      expect(result.phase).toBe("dusk");
      expect(result.phase_progress).toBe(0);
    });

    it("returns night after dusk ends", () => {
      const cycleStart = new Date("2025-01-01T00:00:00Z");
      // Dawn (2 min) + Day (8 min) + Dusk (2 min) = 12 minutes
      const afterDusk = new Date("2025-01-01T00:12:00Z");

      const result = calculatePhase(cycleStart, afterDusk);

      expect(result.phase).toBe("night");
      expect(result.phase_progress).toBe(0);
    });

    it("cycles back to dawn after full cycle", () => {
      const cycleStart = new Date("2025-01-01T00:00:00Z");
      // Full cycle = 20 minutes
      const afterCycle = new Date("2025-01-01T00:20:00Z");

      const result = calculatePhase(cycleStart, afterCycle);

      expect(result.phase).toBe("dawn");
      expect(result.phase_progress).toBe(0);
    });

    it("calculates correct progress mid-phase", () => {
      const cycleStart = new Date("2025-01-01T00:00:00Z");
      // 1 minute into dawn (half of 2 minutes)
      const midDawn = new Date("2025-01-01T00:01:00Z");

      const result = calculatePhase(cycleStart, midDawn);

      expect(result.phase).toBe("dawn");
      expect(result.phase_progress).toBeCloseTo(0.5);
      expect(result.next_phase_in_seconds).toBe(60);
    });

    it("handles future cycle start", () => {
      const now = new Date("2025-01-01T00:00:00Z");
      const futureCycleStart = new Date("2025-01-01T00:05:00Z");

      const result = calculatePhase(futureCycleStart, now);

      expect(result.phase).toBe("dawn");
      expect(result.phase_progress).toBe(0);
    });

    it("handles multiple cycles elapsed", () => {
      const cycleStart = new Date("2025-01-01T00:00:00Z");
      // 3 full cycles + 5 minutes = 65 minutes
      const later = new Date("2025-01-01T01:05:00Z");

      const result = calculatePhase(cycleStart, later);

      // 5 minutes into a cycle = 2 min dawn + 3 min day = mid-day
      expect(result.phase).toBe("day");
      // 3 minutes into 8-minute day phase = 3/8 = 0.375
      expect(result.phase_progress).toBeCloseTo(0.375);
    });
  });

  describe("getNextPhase", () => {
    it("returns day after dawn", () => {
      expect(getNextPhase("dawn")).toBe("day");
    });

    it("returns dusk after day", () => {
      expect(getNextPhase("day")).toBe("dusk");
    });

    it("returns night after dusk", () => {
      expect(getNextPhase("dusk")).toBe("night");
    });

    it("returns dawn after night", () => {
      expect(getNextPhase("night")).toBe("dawn");
    });
  });

  describe("constants", () => {
    it("has correct cycle duration", () => {
      expect(CYCLE_DURATION_SECONDS).toBe(20 * 60); // 20 minutes
    });

    it("has all phase durations summing to cycle", () => {
      const sum =
        PHASE_DURATIONS.dawn +
        PHASE_DURATIONS.day +
        PHASE_DURATIONS.dusk +
        PHASE_DURATIONS.night;
      expect(sum).toBe(CYCLE_DURATION_SECONDS);
    });

    it("has multipliers for all phases", () => {
      expect(PHASE_MULTIPLIERS.dawn).toBeDefined();
      expect(PHASE_MULTIPLIERS.day).toBeDefined();
      expect(PHASE_MULTIPLIERS.dusk).toBeDefined();
      expect(PHASE_MULTIPLIERS.night).toBeDefined();
    });
  });
});
