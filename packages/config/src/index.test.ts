import { describe, it, expect } from "vitest";
import { calculateCityScore } from "./index";

describe("calculateCityScore", () => {
  it("returns 100 for perfect health and no rust", () => {
    expect(calculateCityScore(100, 0)).toBe(100);
  });

  it("returns 0 for no health", () => {
    expect(calculateCityScore(0, 0)).toBe(0);
    expect(calculateCityScore(0, 0.5)).toBe(0);
  });

  it("reduces score proportionally with rust", () => {
    // 100 health, 50% rust = 50 score
    expect(calculateCityScore(100, 0.5)).toBe(50);
    // 80 health, 20% rust = 64 score
    expect(calculateCityScore(80, 0.2)).toBe(64);
    // 90 health, 10% rust = 81 score
    expect(calculateCityScore(90, 0.1)).toBe(81);
  });

  it("handles null values as 0", () => {
    expect(calculateCityScore(null, null)).toBe(0);
    expect(calculateCityScore(100, null)).toBe(100);
    expect(calculateCityScore(null, 0.5)).toBe(0);
  });

  it("clamps values to valid ranges", () => {
    // Health over 100 is clamped
    expect(calculateCityScore(150, 0)).toBe(100);
    // Rust over 1 is clamped
    expect(calculateCityScore(100, 1.5)).toBe(0);
    // Negative values are clamped to 0
    expect(calculateCityScore(-10, 0)).toBe(0);
    expect(calculateCityScore(100, -0.5)).toBe(100);
  });

  it("returns integer scores", () => {
    // 75 health, 33% rust = 50.25, should round to 50
    const score = calculateCityScore(75, 0.33);
    expect(Number.isInteger(score)).toBe(true);
  });
});
