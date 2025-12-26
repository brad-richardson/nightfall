import { describe, expect, it } from "vitest";
import { buildRoadGraph, routeGraph } from "./roadRouting";

describe("roadRouting", () => {
  it("builds a path across connected road segments", () => {
    const roads = [
      { geometry: { coordinates: [[0, 0], [1, 0], [2, 0]] } },
      { geometry: { coordinates: [[2, 0], [2, 1]] } }
    ];

    const graph = buildRoadGraph(roads);
    const route = routeGraph(graph, [0, 0], [2, 1]);
    expect(route).toBeTruthy();
    expect(route?.pathEdges.length).toBeGreaterThan(0);
    expect(route?.pathEdges[0][0]).toEqual([0, 0]);
  });
});
