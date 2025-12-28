import { describe, expect, it, afterEach } from "vitest";
import {
  getAppVersion,
  parseBBox,
  parseTypes,
  clamp,
  haversineDistanceMeters,
  getNextReset,
  parseAllowedOrigins
} from "../utils/helpers";

describe("helper utilities", () => {
  describe("getAppVersion", () => {
    afterEach(() => {
      delete process.env.APP_VERSION;
    });

    it("returns APP_VERSION from environment", () => {
      process.env.APP_VERSION = "1.2.3";
      expect(getAppVersion()).toBe("1.2.3");
    });

    it("returns 'dev' when APP_VERSION is not set", () => {
      delete process.env.APP_VERSION;
      expect(getAppVersion()).toBe("dev");
    });
  });

  describe("parseBBox", () => {
    it("parses valid bbox string", () => {
      const result = parseBBox("-122.4,37.7,-122.3,37.8");
      expect(result).toEqual([-122.4, 37.7, -122.3, 37.8]);
    });

    it("handles bbox with spaces", () => {
      const result = parseBBox("-122.4, 37.7, -122.3, 37.8");
      expect(result).toEqual([-122.4, 37.7, -122.3, 37.8]);
    });

    it("returns null for undefined", () => {
      expect(parseBBox(undefined)).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(parseBBox("")).toBeNull();
    });

    it("returns null for invalid number of parts", () => {
      expect(parseBBox("1,2,3")).toBeNull();
      expect(parseBBox("1,2,3,4,5")).toBeNull();
    });

    it("returns null for non-numeric values", () => {
      expect(parseBBox("a,b,c,d")).toBeNull();
    });
  });

  describe("parseTypes", () => {
    it("parses valid feature types", () => {
      const result = parseTypes("road,building");
      expect(result).toEqual(["road", "building"]);
    });

    it("filters invalid feature types", () => {
      const result = parseTypes("road,invalid,building");
      expect(result).toEqual(["road", "building"]);
    });

    it("returns null for undefined", () => {
      expect(parseTypes(undefined)).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(parseTypes("")).toBeNull();
    });

    it("returns null when all types are invalid", () => {
      expect(parseTypes("invalid,unknown")).toBeNull();
    });

    it("handles whitespace", () => {
      const result = parseTypes(" road , building ");
      expect(result).toEqual(["road", "building"]);
    });
  });

  describe("clamp", () => {
    it("returns value when within range", () => {
      expect(clamp(5, 0, 10)).toBe(5);
    });

    it("returns min when value is below range", () => {
      expect(clamp(-5, 0, 10)).toBe(0);
    });

    it("returns max when value is above range", () => {
      expect(clamp(15, 0, 10)).toBe(10);
    });

    it("returns boundary values correctly", () => {
      expect(clamp(0, 0, 10)).toBe(0);
      expect(clamp(10, 0, 10)).toBe(10);
    });
  });

  describe("haversineDistanceMeters", () => {
    it("returns 0 for same point", () => {
      const point: [number, number] = [-122.4, 37.7];
      expect(haversineDistanceMeters(point, point)).toBe(0);
    });

    it("calculates distance between two points", () => {
      // San Francisco to Oakland (~13km)
      const sf: [number, number] = [-122.4194, 37.7749];
      const oakland: [number, number] = [-122.2712, 37.8044];
      const distance = haversineDistanceMeters(sf, oakland);
      expect(distance).toBeGreaterThan(12000);
      expect(distance).toBeLessThan(15000);
    });

    it("is symmetric", () => {
      const a: [number, number] = [-122.4, 37.7];
      const b: [number, number] = [-122.3, 37.8];
      expect(haversineDistanceMeters(a, b)).toBeCloseTo(haversineDistanceMeters(b, a));
    });
  });

  describe("getNextReset", () => {
    it("returns next Sunday midnight UTC", () => {
      // Wednesday, Dec 25, 2024 at 12:00 UTC
      const wednesday = new Date("2024-12-25T12:00:00Z");
      const result = getNextReset(wednesday);
      expect(result).toBe("2024-12-29T00:00:00.000Z"); // Sunday
    });

    it("returns next Sunday when called on Sunday at midnight", () => {
      // Sunday, Dec 29, 2024 at 00:00 UTC
      const sunday = new Date("2024-12-29T00:00:00.000Z");
      const result = getNextReset(sunday);
      expect(result).toBe("2024-12-29T00:00:00.000Z");
    });

    it("returns next Sunday when called on Sunday after midnight", () => {
      // Sunday, Dec 29, 2024 at 01:00 UTC
      const sundayAfterMidnight = new Date("2024-12-29T01:00:00Z");
      const result = getNextReset(sundayAfterMidnight);
      expect(result).toBe("2025-01-05T00:00:00.000Z"); // Next Sunday
    });
  });

  describe("parseAllowedOrigins", () => {
    it("returns true for undefined", () => {
      expect(parseAllowedOrigins(undefined)).toBe(true);
    });

    it("returns true for empty string", () => {
      expect(parseAllowedOrigins("")).toBe(true);
    });

    it("parses comma-separated origins", () => {
      const result = parseAllowedOrigins("https://a.com,https://b.com");
      expect(result).toEqual(["https://a.com", "https://b.com"]);
    });

    it("trims whitespace from origins", () => {
      const result = parseAllowedOrigins(" https://a.com , https://b.com ");
      expect(result).toEqual(["https://a.com", "https://b.com"]);
    });

    it("filters empty parts", () => {
      const result = parseAllowedOrigins("https://a.com,,https://b.com");
      expect(result).toEqual(["https://a.com", "https://b.com"]);
    });

    it("returns true when only whitespace/empty parts", () => {
      expect(parseAllowedOrigins(",,,")).toBe(true);
      expect(parseAllowedOrigins("   ,   ")).toBe(true);
    });
  });
});
