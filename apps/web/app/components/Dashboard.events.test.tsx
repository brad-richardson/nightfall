import React from "react";
import { render, waitFor } from "@testing-library/react";
import { act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard from "./Dashboard";
import { useStore } from "../store";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() })
}));

const eventHandlers: Array<(payload: { event: string; data: unknown }) => void> = [];

vi.mock("./DemoMap", () => ({
  __esModule: true,
  default: () => <div data-testid="demo-map" />
}));
vi.mock("./FeaturePanel", () => ({ default: () => <div data-testid="feature-panel" /> }));
vi.mock("./TaskList", () => ({ default: () => <div data-testid="task-list" /> }));
vi.mock("./ActivityFeed", () => ({ default: () => <div data-testid="activity-feed" /> }));
vi.mock("./MobileSidebar", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("./PhaseIndicator", () => ({ default: () => <div data-testid="phase-indicator" /> }));

vi.mock("../hooks/useEventStream", () => ({
  useEventStream: (_baseUrl: string, handler: (payload: { event: string; data: unknown }) => void) => {
    eventHandlers.push(handler);
  }
}));

const initialRegion = {
  region_id: "region-1",
  name: "Region One",
  boundary: { type: "Polygon", coordinates: [[[-68.35, 44.31], [-68.15, 44.31], [-68.15, 44.45], [-68.35, 44.45], [-68.35, 44.31]]] },
  pool_labor: 100,
  pool_materials: 200,
  crews: [],
  tasks: [],
  stats: {
    total_roads: 0,
    healthy_roads: 0,
    degraded_roads: 0,
    rust_avg: 0,
    health_avg: 100
  }
};

const initialCycle = {
  phase: "day" as const,
  phase_progress: 0.1,
  next_phase: "dusk" as const,
  next_phase_in_seconds: 1200
};

const resetStore = () => {
  useStore.setState({
    region: initialRegion,
    features: [],
    hexes: [],
    cycle: initialCycle,
    isDemoMode: false,
    availableRegions: [
      { region_id: "region-1", name: "Region One" }
    ],
    auth: { clientId: "", token: "" },
    feedItems: []
  });
};

describe("Dashboard live events", () => {
  beforeEach(() => {
    eventHandlers.length = 0;
    resetStore();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const renderDashboard = () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const href = typeof url === "string" ? url : url.toString();

      if (href.includes("/api/hello")) {
        return new Response(JSON.stringify({ token: "test-token" }), { status: 200 });
      }

      if (href.includes("/api/region/region-1")) {
        return new Response(JSON.stringify({
          ...initialRegion,
          tasks: [{
            task_id: "task-2",
            target_gers_id: "road-2",
            priority_score: 5,
            status: "queued",
            vote_score: 0,
            cost_labor: 10,
            cost_materials: 10,
            duration_s: 10,
            repair_amount: 5,
            task_type: "repair_road"
          }]
        }), { status: 200 });
      }

      if (href.includes("/api/features")) {
        return new Response(JSON.stringify({ features: [{ gers_id: "road-1", feature_type: "road", bbox: [-68.2, 44.32, -68.18, 44.34] }] }), { status: 200 });
      }

      if (href.includes("/api/hexes")) {
        return new Response(JSON.stringify({ hexes: [{ h3_index: "abc", rust_level: 0.5 }] }), { status: 200 });
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    vi.stubGlobal("fetch", fetchMock);

    render(
      <Dashboard
        initialRegion={initialRegion}
        initialFeatures={[]}
        initialHexes={[]}
        initialCycle={initialCycle}
        availableRegions={[{ region_id: "region-1", name: "Region One" }]}
        isDemoMode={false}
        apiBaseUrl="http://localhost:3001"
        pmtilesRelease="2025-12-17"
      />
    );

    return fetchMock;
  };

  it("applies world/task deltas without refetching", async () => {
    const fetchMock = renderDashboard();
    const handler = eventHandlers.at(-1)!;

    expect(fetchMock).toHaveBeenCalledTimes(1); // /api/hello

    await act(async () => {
      handler({
        event: "world_delta",
        data: {
          hex_updates: [{ h3_index: "abc", rust_level: 0.4 }],
          region_updates: [{
            region_id: "region-1",
            pool_labor: 150,
            pool_materials: 250,
            rust_avg: 0.2,
            health_avg: 85
          }]
        }
      });
    });

    expect(useStore.getState().hexes).toEqual([{ h3_index: "abc", rust_level: 0.4 }]);
    expect(useStore.getState().region.pool_labor).toBe(150);
    expect(useStore.getState().region.pool_materials).toBe(250);
    expect(useStore.getState().region.stats.rust_avg).toBe(0.2);
    expect(useStore.getState().region.stats.health_avg).toBe(85);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      handler({
        event: "task_delta",
        data: {
          task_id: "task-new",
          status: "queued",
          priority_score: 5,
          vote_score: 1,
          cost_labor: 10,
          cost_materials: 20,
          duration_s: 30,
          repair_amount: 5,
          task_type: "repair_road",
          target_gers_id: "road-123",
          region_id: "region-1"
        }
      });
    });

    const tasks = useStore.getState().region.tasks;
    expect(tasks.find((t) => t.task_id === "task-new")).toMatchObject({
      task_id: "task-new",
      vote_score: 1,
      target_gers_id: "road-123"
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("merges cycle updates on phase_change", async () => {
    renderDashboard();
    const handler = eventHandlers.at(-1)!;

    await act(async () => {
      handler({
        event: "phase_change",
        data: { phase: "night", next_phase: "dawn", next_phase_in_seconds: 30, phase_progress: 0.5 }
      });
    });

    await waitFor(() => {
      const cycle = useStore.getState().cycle;
      expect(cycle.phase).toBe("night");
      expect(cycle.phase_progress).toBeCloseTo(0.5);
    });
  });
});
