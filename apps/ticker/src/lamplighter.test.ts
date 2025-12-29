import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  runLamplighter,
  fetchRegionStates,
  pickRandom,
  formatMessage,
  type RegionState,
} from "./lamplighter";

describe("pickRandom", () => {
  it("returns an element from the array", () => {
    const arr = ["a", "b", "c"];
    const result = pickRandom(arr);
    expect(arr).toContain(result);
  });

  it("returns the only element from single-element array", () => {
    expect(pickRandom(["only"])).toBe("only");
  });

  it("throws an error for empty array", () => {
    expect(() => pickRandom([])).toThrow("pickRandom called with empty array");
  });
});

describe("formatMessage", () => {
  it("replaces placeholders with values", () => {
    const template = "Hello {name}, welcome to {place}!";
    const result = formatMessage(template, { name: "Alice", place: "Nightfall" });
    expect(result).toBe("Hello Alice, welcome to Nightfall!");
  });

  it("leaves unmatched placeholders intact", () => {
    const template = "Hello {name}, {unknown}!";
    const result = formatMessage(template, { name: "Bob" });
    expect(result).toBe("Hello Bob, {unknown}!");
  });

  it("handles empty vars object", () => {
    const template = "No {vars} here";
    const result = formatMessage(template, {});
    expect(result).toBe("No {vars} here");
  });
});

describe("fetchRegionStates", () => {
  it("queries regions with rust and health averages", async () => {
    const mockRegions: RegionState[] = [
      {
        region_id: "region-1",
        name: "Downtown",
        pool_food: 100,
        pool_equipment: 50,
        pool_energy: 75,
        pool_materials: 80,
        rust_avg: 0.3,
        health_avg: 70,
      },
    ];

    const query = vi.fn().mockResolvedValue({ rows: mockRegions });

    const result = await fetchRegionStates({ query });

    expect(result).toEqual(mockRegions);
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0][0])).toContain("SELECT");
    expect(String(query.mock.calls[0][0])).toContain("regions");
  });
});

describe("runLamplighter", () => {
  let query: ReturnType<typeof vi.fn>;

  const mockRegions: RegionState[] = [
    {
      region_id: "region-1",
      name: "Downtown",
      pool_food: 100,
      pool_equipment: 50,
      pool_energy: 75,
      pool_materials: 80,
      rust_avg: 0.3,
      health_avg: 70,
    },
    {
      region_id: "region-2",
      name: "Harbor",
      pool_food: 30,
      pool_equipment: 20,
      pool_energy: 25,
      pool_materials: 25,
      rust_avg: 0.6,
      health_avg: 45,
    },
  ];

  beforeEach(() => {
    query = vi.fn();
  });

  it("returns empty result when disabled", async () => {
    const result = await runLamplighter({ query }, false, "day");

    expect(result).toEqual({
      observations: 0,
      contributions: 0,
      votes: 0,
      warnings: 0,
      regionActivities: 0,
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("activates a building when probability check passes", async () => {
    const mockBuilding = {
      gers_id: "building-1",
      name: "Test Building",
      generates_food: true,
      generates_equipment: false,
      generates_energy: false,
      generates_materials: false,
    };

    // Mock Math.random to control the 20% probability check
    const originalRandom = Math.random;
    let callCount = 0;
    Math.random = () => {
      callCount++;
      // First call is the 20% check - pass it (value <= 0.20)
      if (callCount === 1) return 0.1;
      // Subsequent calls for pickRandom and isLamplighter check
      return 0.5;
    };

    query
      .mockResolvedValueOnce({ rows: mockRegions }) // fetchRegionStates
      .mockImplementation((sql: string) => {
        if (typeof sql === "string" && sql.includes("world_features") && sql.includes("generates_food")) {
          return Promise.resolve({ rows: [mockBuilding] });
        }
        if (typeof sql === "string" && sql.includes("INSERT INTO feature_state")) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

    try {
      const result = await runLamplighter({ query }, true, "day");
      expect(result.contributions).toBe(1);
    } finally {
      Math.random = originalRandom;
    }
  });

  it("skips activation when probability check fails", async () => {
    // Mock Math.random to fail the 20% probability check
    const originalRandom = Math.random;
    Math.random = () => 0.5; // > 0.20, so check fails

    try {
      const result = await runLamplighter({ query }, true, "day");
      expect(result.contributions).toBe(0);
      expect(query).not.toHaveBeenCalled();
    } finally {
      Math.random = originalRandom;
    }
  });

  it("returns empty when no regions exist", async () => {
    query.mockResolvedValueOnce({ rows: [] });

    // Force the probability check to pass by mocking Math.random
    const originalRandom = Math.random;
    Math.random = () => 0.1; // Always passes the 20% check

    try {
      const result = await runLamplighter({ query }, true, "day");
      expect(result.contributions).toBe(0);
    } finally {
      Math.random = originalRandom;
    }
  });

  it("sends notification when building is activated", async () => {
    const mockBuilding = {
      gers_id: "building-1",
      name: "Test Building",
      generates_food: true,
      generates_equipment: false,
      generates_energy: false,
      generates_materials: false,
    };

    // Force the probability check to pass
    const originalRandom = Math.random;
    let callCount = 0;
    Math.random = () => {
      callCount++;
      // First call is the 20% check - pass it
      if (callCount === 1) return 0.1;
      // Subsequent calls for other random selections
      return 0.5;
    };

    query
      .mockResolvedValueOnce({ rows: mockRegions }) // fetchRegionStates
      .mockImplementation((sql: string) => {
        if (typeof sql === "string" && sql.includes("world_features") && sql.includes("generates_food")) {
          return Promise.resolve({ rows: [mockBuilding] });
        }
        if (typeof sql === "string" && sql.includes("INSERT INTO feature_state")) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

    try {
      const result = await runLamplighter({ query }, true, "day");

      // With mocked random passing and building found, expect 1 contribution
      expect(result.contributions).toBe(1);

      // Check that notification was sent
      const notifyCalls = query.mock.calls.filter(
        (call) => typeof call[0] === "string" && call[0].includes("pg_notify")
      );
      expect(notifyCalls.length).toBe(1);
    } finally {
      Math.random = originalRandom;
    }
  });
});

describe("Lamplighter message content", () => {
  it("includes region name in formatted messages", () => {
    const template = "Workers in {region} begin their morning rounds.";
    const result = formatMessage(template, { region: "Downtown" });
    expect(result).toBe("Workers in Downtown begin their morning rounds.");
  });
});
