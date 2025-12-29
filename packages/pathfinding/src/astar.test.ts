import { describe, expect, it } from "vitest";
import {
  buildWaypoints,
  findPath,
  findNearestConnector,
  haversineDistanceMeters,
  healthSlowdownMultiplier,
  edgeWeight,
} from "./astar.js";
import type { Graph, ConnectorCoords, PathResult } from "./types.js";

describe("healthSlowdownMultiplier", () => {
  it("returns 1 for health at 100", () => {
    expect(healthSlowdownMultiplier(100)).toBe(1);
  });

  it("returns higher multiplier for lower health", () => {
    expect(healthSlowdownMultiplier(50)).toBe(2);
  });

  it("caps at 3x for healthy roads", () => {
    // Health > degraded threshold (50) caps at 3x
    expect(healthSlowdownMultiplier(60)).toBeLessThanOrEqual(3);
  });

  it("caps at 2x for degraded roads", () => {
    // Health < degraded threshold (50) caps at 2x
    expect(healthSlowdownMultiplier(30)).toBe(2);
  });
});

describe("edgeWeight", () => {
  it("calculates weight based on distance and health", () => {
    const weight = edgeWeight(100, 50);
    expect(weight).toBe(200); // 100m * 2x multiplier
  });
});

describe("haversineDistanceMeters", () => {
  it("calculates distance between two points", () => {
    const distance = haversineDistanceMeters([-68.2, 44.4], [-68.21, 44.41]);
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThan(2000); // Should be less than 2km
  });

  it("returns 0 for same point", () => {
    const distance = haversineDistanceMeters([-68.2, 44.4], [-68.2, 44.4]);
    expect(distance).toBe(0);
  });
});

describe("findNearestConnector", () => {
  it("finds the nearest connector within max distance", () => {
    const coords: ConnectorCoords = new Map([
      ["c1", [-68.2, 44.4]],
      ["c2", [-68.21, 44.41]],
      ["c3", [-68.22, 44.42]],
    ]);

    // Point very close to c2
    const nearest = findNearestConnector(coords, [-68.2101, 44.4101]);
    expect(nearest).toBe("c2");
  });

  it("returns null when no connectors are within max distance", () => {
    const coords: ConnectorCoords = new Map([
      ["c1", [0, 0]],
    ]);

    const nearest = findNearestConnector(coords, [-68.2, 44.4], 100);
    expect(nearest).toBeNull();
  });
});

describe("findPath", () => {
  it("finds a path between two connectors", () => {
    const graph: Graph = new Map([
      ["c1", [{ segmentGersId: "s1", toConnector: "c2", lengthMeters: 100, health: 100 }]],
      ["c2", [
        { segmentGersId: "s1", toConnector: "c1", lengthMeters: 100, health: 100 },
        { segmentGersId: "s2", toConnector: "c3", lengthMeters: 100, health: 100 },
      ]],
      ["c3", [{ segmentGersId: "s2", toConnector: "c2", lengthMeters: 100, health: 100 }]],
    ]);

    const coords: ConnectorCoords = new Map([
      ["c1", [-68.2, 44.4]],
      ["c2", [-68.21, 44.4]],
      ["c3", [-68.22, 44.4]],
    ]);

    const result = findPath(graph, coords, "c1", "c3");
    expect(result).not.toBeNull();
    expect(result?.connectorIds).toEqual(["c1", "c2", "c3"]);
    expect(result?.segmentGersIds).toEqual(["s1", "s2"]);
  });

  it("returns null when no path exists", () => {
    const graph: Graph = new Map([
      ["c1", []],
      ["c2", []],
    ]);

    const coords: ConnectorCoords = new Map([
      ["c1", [-68.2, 44.4]],
      ["c2", [-68.21, 44.4]],
    ]);

    const result = findPath(graph, coords, "c1", "c2");
    expect(result).toBeNull();
  });

  it("returns single connector path for same start and end", () => {
    const graph: Graph = new Map();
    const coords: ConnectorCoords = new Map([["c1", [-68.2, 44.4]]]);

    const result = findPath(graph, coords, "c1", "c1");
    expect(result?.connectorIds).toEqual(["c1"]);
    expect(result?.totalDistance).toBe(0);
  });
});

describe("buildWaypoints", () => {
  const basePathResult: PathResult = {
    connectorIds: ["c1", "c2", "c3"],
    segmentGersIds: ["s1", "s2"],
    segmentHealths: [100, 100],
    segmentLengths: [100, 100],
    totalDistance: 200,
    totalWeightedDistance: 200,
  };

  const coords: ConnectorCoords = new Map([
    ["c1", [-68.20, 44.40]],
    ["c2", [-68.21, 44.40]],
    ["c3", [-68.22, 44.40]],
  ]);

  it("builds waypoints from path result", () => {
    const departAt = Date.now();
    const waypoints = buildWaypoints(basePathResult, coords, departAt, 10);

    expect(waypoints).toHaveLength(3);
    expect(waypoints[0].coord).toEqual([-68.20, 44.40]);
    expect(waypoints[2].coord).toEqual([-68.22, 44.40]);
  });

  it("calculates travel time based on distance and speed", () => {
    const departAt = Date.now();
    const speedMps = 10;
    const waypoints = buildWaypoints(basePathResult, coords, departAt, speedMps);

    const firstTime = Date.parse(waypoints[0].arrive_at);
    const lastTime = Date.parse(waypoints[2].arrive_at);
    const travelTimeS = (lastTime - firstTime) / 1000;

    // 200m at 10m/s = 20s (with 100% health, no slowdown)
    expect(travelTimeS).toBeCloseTo(20, 0);
  });

  it("applies health slowdown multiplier", () => {
    const degradedPath: PathResult = {
      ...basePathResult,
      segmentHealths: [50, 50], // 50% health = 2x slowdown
    };

    const departAt = Date.now();
    const speedMps = 10;
    const waypoints = buildWaypoints(degradedPath, coords, departAt, speedMps);

    const firstTime = Date.parse(waypoints[0].arrive_at);
    const lastTime = Date.parse(waypoints[2].arrive_at);
    const travelTimeS = (lastTime - firstTime) / 1000;

    // 200m at 10m/s with 2x slowdown = 40s
    expect(travelTimeS).toBeCloseTo(40, 0);
  });

  describe("with actualStart option", () => {
    it("prepends actual start point to waypoints", () => {
      const actualStart: [number, number] = [-68.195, 44.405]; // Off-road building location
      const departAt = Date.now();
      const waypoints = buildWaypoints(basePathResult, coords, departAt, 10, {
        actualStart,
      });

      expect(waypoints).toHaveLength(4);
      expect(waypoints[0].coord).toEqual(actualStart);
      expect(waypoints[1].coord).toEqual([-68.20, 44.40]); // First connector
    });

    it("includes travel time from actual start to first connector", () => {
      const actualStart: [number, number] = [-68.195, 44.405];
      const departAt = Date.now();
      const speedMps = 10;
      const waypoints = buildWaypoints(basePathResult, coords, departAt, speedMps, {
        actualStart,
      });

      const startTime = Date.parse(waypoints[0].arrive_at);
      const connectorTime = Date.parse(waypoints[1].arrive_at);
      const timeToConnectorS = (connectorTime - startTime) / 1000;

      // Should have some positive time to reach first connector
      expect(timeToConnectorS).toBeGreaterThan(0);
    });
  });

  describe("with actualEnd option", () => {
    it("appends actual end point to waypoints", () => {
      const actualEnd: [number, number] = [-68.225, 44.395]; // Off-road building location
      const departAt = Date.now();
      const waypoints = buildWaypoints(basePathResult, coords, departAt, 10, {
        actualEnd,
      });

      expect(waypoints).toHaveLength(4);
      expect(waypoints[2].coord).toEqual([-68.22, 44.40]); // Last connector
      expect(waypoints[3].coord).toEqual(actualEnd);
    });

    it("includes travel time from last connector to actual end", () => {
      const actualEnd: [number, number] = [-68.225, 44.395];
      const departAt = Date.now();
      const speedMps = 10;
      const waypoints = buildWaypoints(basePathResult, coords, departAt, speedMps, {
        actualEnd,
      });

      const lastConnectorTime = Date.parse(waypoints[2].arrive_at);
      const endTime = Date.parse(waypoints[3].arrive_at);
      const timeFromConnectorS = (endTime - lastConnectorTime) / 1000;

      // Should have some positive time from last connector
      expect(timeFromConnectorS).toBeGreaterThan(0);
    });
  });

  describe("with both actualStart and actualEnd options", () => {
    it("includes both off-road segments", () => {
      const actualStart: [number, number] = [-68.195, 44.405];
      const actualEnd: [number, number] = [-68.225, 44.395];
      const departAt = Date.now();
      const waypoints = buildWaypoints(basePathResult, coords, departAt, 10, {
        actualStart,
        actualEnd,
      });

      expect(waypoints).toHaveLength(5);
      expect(waypoints[0].coord).toEqual(actualStart);
      expect(waypoints[1].coord).toEqual([-68.20, 44.40]); // First connector
      expect(waypoints[3].coord).toEqual([-68.22, 44.40]); // Last connector
      expect(waypoints[4].coord).toEqual(actualEnd);
    });

    it("calculates total travel time including off-road segments", () => {
      const actualStart: [number, number] = [-68.195, 44.405];
      const actualEnd: [number, number] = [-68.225, 44.395];
      const departAt = Date.now();
      const speedMps = 10;
      const waypoints = buildWaypoints(basePathResult, coords, departAt, speedMps, {
        actualStart,
        actualEnd,
      });

      const startTime = Date.parse(waypoints[0].arrive_at);
      const endTime = Date.parse(waypoints[waypoints.length - 1].arrive_at);
      const totalTravelTimeS = (endTime - startTime) / 1000;

      // Should be longer than just the road path (which is 20s for 200m at 10m/s)
      expect(totalTravelTimeS).toBeGreaterThan(20);
    });
  });
});
