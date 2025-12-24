import { describe, expect, it } from "vitest";
import { computeCycleSnapshot } from "./cycle";

describe("computeCycleSnapshot", () => {
  it("calculates the current phase and progress", () => {
    const cycleStart = Date.UTC(2025, 0, 1, 0, 0, 0);
    const now = cycleStart + 3 * 60 * 1000;

    const snapshot = computeCycleSnapshot(now, cycleStart);

    expect(snapshot.phase).toBe("day");
    expect(snapshot.phaseProgress).toBeCloseTo(0.125, 3);
    expect(snapshot.nextPhase).toBe("dusk");
    expect(snapshot.nextPhaseInMs).toBe(7 * 60 * 1000);
  });

  it("wraps across cycle boundaries", () => {
    const cycleStart = Date.UTC(2025, 0, 1, 0, 0, 0);
    const now = cycleStart + 21 * 60 * 1000;

    const snapshot = computeCycleSnapshot(now, cycleStart);

    expect(snapshot.phase).toBe("dawn");
    expect(snapshot.nextPhase).toBe("day");
  });
});
