import { type Page } from "@playwright/test";

// Mock data for API responses
export const MOCK_REGION = {
  region_id: "bar_harbor_me_usa_demo",
  name: "Bar Harbor",
  boundary: {
    type: "Polygon" as const,
    coordinates: [[
      [-68.25, 44.35],
      [-68.18, 44.35],
      [-68.18, 44.42],
      [-68.25, 44.42],
      [-68.25, 44.35]
    ]]
  },
  pool_food: 1000,
  pool_equipment: 800,
  pool_energy: 600,
  pool_materials: 500,
  focus_h3_index: null,
  crews: [],
  tasks: [],
  resource_transfers: [],
  stats: {
    total_roads: 100,
    healthy_roads: 80,
    degraded_roads: 20,
    rust_avg: 0.2,
    health_avg: 75,
    score: 75
  }
};

export const MOCK_WORLD = {
  world_version: 1,
  last_reset: new Date().toISOString(),
  next_reset: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  demo_mode: true,
  city_score: 75,
  cycle: {
    phase: "day" as const,
    phase_progress: 0.5,
    phase_start: new Date().toISOString(),
    next_phase: "dusk" as const,
    next_phase_in_seconds: 240
  },
  regions: [
    {
      region_id: "bar_harbor_me_usa_demo",
      name: "Bar Harbor",
      center: { type: "Point", coordinates: [-68.21, 44.39] },
      pool_food: 1000,
      pool_equipment: 800,
      pool_energy: 600,
      pool_materials: 500,
      crew_count: 5,
      active_crews: 2,
      rust_avg: 0.2,
      health_avg: 75,
      score: 75
    }
  ]
};

export const MOCK_FEATURES = {
  features: [
    {
      gers_id: "road-001",
      feature_type: "road",
      h3_index: "8428b1affffffff",
      bbox: [-68.22, 44.38, -68.20, 44.40],
      geometry: {
        type: "LineString",
        coordinates: [[-68.22, 44.38], [-68.21, 44.39], [-68.20, 44.40]]
      },
      health: 85,
      status: "normal",
      road_class: "secondary",
      place_category: null,
      generates_food: false,
      generates_equipment: false,
      generates_energy: false,
      generates_materials: false,
      is_hub: false
    },
    {
      gers_id: "building-001",
      feature_type: "building",
      h3_index: "8428b1affffffff",
      bbox: [-68.215, 44.385, -68.205, 44.395],
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-68.215, 44.385],
          [-68.205, 44.385],
          [-68.205, 44.395],
          [-68.215, 44.395],
          [-68.215, 44.385]
        ]]
      },
      health: 100,
      status: "normal",
      road_class: null,
      place_category: "restaurant",
      generates_food: true,
      generates_equipment: false,
      generates_energy: false,
      generates_materials: false,
      is_hub: false
    }
  ]
};

export const MOCK_HEXES = {
  hexes: [
    { h3_index: "8428b1affffffff", rust_level: 0.2 },
    { h3_index: "8428b1bffffffff", rust_level: 0.1 }
  ]
};

export const MOCK_OVERTURE = {
  ok: true,
  release: "2024-12-01"
};

/**
 * Sets up API route mocking for the frontend tests.
 * This allows tests to run without a database by providing mock responses.
 * Intercepts requests at the frontend origin (requests are proxied by Next.js).
 */
export async function setupApiMocks(page: Page) {
  // Mock /api/world endpoint - use pattern to match both origins
  await page.route("**/api/world", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_WORLD)
    });
  });

  // Mock /api/region/:region_id endpoint
  await page.route("**/api/region/*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_REGION)
    });
  });

  // Mock /api/features endpoint
  await page.route("**/api/features*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_FEATURES)
    });
  });

  // Mock /api/hexes endpoint
  await page.route("**/api/hexes*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_HEXES)
    });
  });

  // Mock /api/overture-latest endpoint
  await page.route("**/api/overture-latest", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_OVERTURE)
    });
  });

  // Mock /api/stream SSE endpoint - return empty but valid SSE
  await page.route("**/api/stream", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: {
        "Cache-Control": "no-store",
        "Connection": "keep-alive"
      },
      body: "event: connected\ndata: {}\n\n"
    });
  });

  // Mock /api/hello endpoint (player registration)
  await page.route("**/api/hello", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        token: "mock-token",
        world_version: 1,
        home_region_id: null,
        regions: MOCK_WORLD.regions,
        cycle: MOCK_WORLD.cycle
      })
    });
  });
}
