import { describe, expect, it } from "vitest";
import { getHealthColor, getRustColor } from "./metricColors";

describe("metricColors", () => {
  it("returns health colors based on thresholds", () => {
    expect(getHealthColor(85)).toBe("#10b981");
    expect(getHealthColor(70)).toBe("#10b981");
    expect(getHealthColor(55)).toBe("#f59e0b");
    expect(getHealthColor(40)).toBe("#f59e0b");
    expect(getHealthColor(10)).toBe("#ef4444");
  });

  it("returns rust colors based on thresholds", () => {
    expect(getRustColor(75)).toBe("#92400e");
    expect(getRustColor(60)).toBe("#92400e");
    expect(getRustColor(45)).toBe("#d97706");
    expect(getRustColor(30)).toBe("#d97706");
    expect(getRustColor(5)).toBe("#fbbf24");
  });
});
