import { afterEach, describe, expect, it } from "vitest";
import {
  buildRoadsQuery,
  buildBuildingsQuery,
  buildBuildingsUpsertQuery,
  applyResourceFallback,
  calculateBuildingWeight,
  limitBuildingsPerHex,
  getRegionConfig,
  getResourcesFromCategories,
  H3_RESOLUTION,
  normalizeCategories,
  ROAD_CLASS_FILTER,
  REGION_CONFIGS,
  shouldSeedDemo,
  interpolateLineString
} from "./index.js";

const region = {
  regionId: "test_region",
  regionName: "Test Region",
  bbox: {
    xmin: 1,
    ymin: 2,
    xmax: 3,
    ymax: 4
  }
};

describe("ingest roads query", () => {
  it("filters to allowed road classes", () => {
    const query = buildRoadsQuery("/tmp/overture/roads", region);

    expect(query).toContain("subtype = 'road'");
    for (const roadClass of ROAD_CLASS_FILTER) {
      expect(query).toContain(`'${roadClass}'`);
    }
  });

  it("scopes query to the provided region bbox", () => {
    const query = buildRoadsQuery("/tmp/overture/roads", region);

    expect(query).toContain("bbox.xmin > 1");
    expect(query).toContain("bbox.xmax < 3");
    expect(query).toContain("bbox.ymin > 2");
    expect(query).toContain("bbox.ymax < 4");
  });

  it("includes the parquet path in the query", () => {
    const query = buildRoadsQuery("/tmp/overture/roads", region);

    expect(query).toContain("read_parquet('/tmp/overture/roads')");
  });

  it("keeps the expected road class ordering", () => {
    const query = buildRoadsQuery("/tmp/overture/roads", region);
    const start = query.indexOf("class IN (");
    const end = query.indexOf(")", start);
    const classList = query.slice(start, end);

    expect(classList).toContain("'motorway'");
    expect(classList).toContain("'service'");
  });

  it("uses the expected h3 resolution", () => {
    expect(H3_RESOLUTION).toBe(7);
  });

  it("keeps the allowed class filter list stable", () => {
    expect(ROAD_CLASS_FILTER).toEqual([
      "motorway",
      "trunk",
      "primary",
      "secondary",
      "tertiary",
      "residential",
      "service"
    ]);
  });
});

describe("region config selection", () => {
  const originalArgv = process.argv.slice();
  const originalEnv = process.env.INGEST_REGION;

  afterEach(() => {
    process.argv = [...originalArgv];
    if (originalEnv === undefined) {
      delete process.env.INGEST_REGION;
    } else {
      process.env.INGEST_REGION = originalEnv;
    }
  });

  it("defaults to the Boston config", () => {
    delete process.env.INGEST_REGION;
    process.argv = [...originalArgv];

    const regionConfig = getRegionConfig();

    expect(regionConfig.regionId).toBe(REGION_CONFIGS.boston_ma_usa.regionId);
  });

  it("uses the env override when provided", () => {
    process.env.INGEST_REGION = "bar_harbor_me_usa_demo";

    const regionConfig = getRegionConfig();

    expect(regionConfig.regionId).toBe("bar_harbor_me_usa_demo");
  });

  it("prefers the CLI flag over the env override", () => {
    process.env.INGEST_REGION = "boston_ma_usa";
    process.argv = [...originalArgv, "--region=bar_harbor_me_usa_demo"];

    const regionConfig = getRegionConfig();

    expect(regionConfig.regionId).toBe("bar_harbor_me_usa_demo");
  });

  it("throws on unknown region ids", () => {
    process.env.INGEST_REGION = "unknown_region";

    expect(() => getRegionConfig()).toThrow(/Unknown region/);
  });
});

describe("demo seed flag", () => {
  const originalArgv = process.argv.slice();

  afterEach(() => {
    process.argv = [...originalArgv];
  });

  it("defaults to false", () => {
    process.argv = [...originalArgv];
    expect(shouldSeedDemo()).toBe(false);
  });

  it("returns true when --seed-demo is present", () => {
    process.argv = [...originalArgv, "--seed-demo"];
    expect(shouldSeedDemo()).toBe(true);
  });

  it("returns true when --demo is present", () => {
    process.argv = [...originalArgv, "--demo"];
    expect(shouldSeedDemo()).toBe(true);
  });
});

describe("building ingest query", () => {
  it("groups places by building id", () => {
    const query = buildBuildingsQuery();

    expect(query).toContain("list(p.categories)");
    expect(query).toContain("GROUP BY");
    expect(query).toContain("b.id");
  });

  it("upserts building records on conflict", () => {
    const query = buildBuildingsUpsertQuery(["($1, 'building', $2)"]);

    expect(query).toContain("ON CONFLICT (gers_id) DO UPDATE");
    expect(query).toContain("place_category = EXCLUDED.place_category");
    expect(query).toContain("generates_food = EXCLUDED.generates_food");
    expect(query).toContain("generates_equipment = EXCLUDED.generates_equipment");
    expect(query).toContain("generates_energy = EXCLUDED.generates_energy");
    expect(query).toContain("generates_materials = EXCLUDED.generates_materials");
  });
});

describe("category resource mapping", () => {
  it("matches food from alternates", () => {
    const categories = { primary: "museum", alternate: ["food_court"] };
    const res = getResourcesFromCategories(categories);

    expect(res.food).toBe(true);
    expect(res.materials).toBe(false);
  });

  it("matches materials from category lists", () => {
    const raw = JSON.stringify([
      { primary: "museum", alternate: null },
      { primary: "warehouse", alternate: ["building_supply_store"] }
    ]);
    const res = getResourcesFromCategories(normalizeCategories(raw));

    expect(res.materials).toBe(true);
    expect(res.cat).toBe("warehouse");
  });

  it("matches equipment from hardware and home improvement categories", () => {
    const categories = [
      { primary: "hardware_store", alternate: null },
      { primary: "home_improvement_store", alternate: null }
    ];
    const res = getResourcesFromCategories(categories);

    expect(res.equipment).toBe(true);
    expect(res.food).toBe(false);
  });

  it("matches energy from industrial categories", () => {
    const categories = { primary: "factory", alternate: null };
    const res = getResourcesFromCategories(categories);

    expect(res.energy).toBe(true);
  });
});

describe("fallback resource assignment", () => {
  it("assigns a resource for a deterministic slice of ids", () => {
    let fallbackFound = false;
    for (let i = 0; i < 1000; i += 1) {
      const id = `fallback-test-${i}`;
      const res = applyResourceFallback(id, { food: false, equipment: false, energy: false, materials: false, cat: null });
      if (res.food || res.equipment || res.energy || res.materials) {
        fallbackFound = true;
        break;
      }
    }

    expect(fallbackFound).toBe(true);
  });

  it("does not override existing resource flags", () => {
    const res = applyResourceFallback("fallback-test-override", {
      food: true,
      equipment: false,
      energy: false,
      materials: false,
      cat: "cafe"
    });

    expect(res.food).toBe(true);
    expect(res.materials).toBe(false);
  });
});

describe("building weight calculation", () => {
  it("gives matched categories higher weight", () => {
    const matchedWeight = calculateBuildingWeight("building-1", 0.001, true);
    const unmatchedWeight = calculateBuildingWeight("building-1", 0.001, false);

    expect(matchedWeight).toBeGreaterThan(unmatchedWeight);
    expect(matchedWeight - unmatchedWeight).toBeGreaterThanOrEqual(1000);
  });

  it("gives larger buildings higher weight", () => {
    const largeWeight = calculateBuildingWeight("building-1", 0.01, false);
    const smallWeight = calculateBuildingWeight("building-1", 0.001, false);

    expect(largeWeight).toBeGreaterThan(smallWeight);
  });

  it("provides deterministic results for same input", () => {
    const weight1 = calculateBuildingWeight("building-abc", 0.005, true);
    const weight2 = calculateBuildingWeight("building-abc", 0.005, true);

    expect(weight1).toBe(weight2);
  });
});

describe("per-hex building limiting", () => {
  const makeBuilding = (id: string, resourceType: "food" | "equipment" | "energy" | "materials", cells: string[], weight: number) => ({
    id,
    xmin: 0,
    ymin: 0,
    xmax: 1,
    ymax: 1,
    categories: null,
    resources: {
      food: resourceType === "food",
      equipment: resourceType === "equipment",
      energy: resourceType === "energy",
      materials: resourceType === "materials",
      cat: resourceType
    },
    weight,
    area: 0.001,
    cells
  });

  it("limits buildings of same type to max per hex", () => {
    const buildings = [];
    for (let i = 0; i < 30; i++) {
      buildings.push(makeBuilding(`building-${i}`, "food", ["hex-1"], 100 - i));
    }

    const limited = limitBuildingsPerHex(buildings, 20);

    expect(limited.length).toBe(20);
    // Should keep highest weight buildings
    expect(limited[0].id).toBe("building-0");
    expect(limited[19].id).toBe("building-19");
  });

  it("allows max buildings of each type per hex", () => {
    const buildings = [];
    for (let i = 0; i < 25; i++) {
      buildings.push(makeBuilding(`food-${i}`, "food", ["hex-1"], 100 - i));
      buildings.push(makeBuilding(`equipment-${i}`, "equipment", ["hex-1"], 100 - i));
    }

    const limited = limitBuildingsPerHex(buildings, 20);

    const foodBuildings = limited.filter(b => b.resources.food);
    const equipmentBuildings = limited.filter(b => b.resources.equipment);

    expect(foodBuildings.length).toBe(20);
    expect(equipmentBuildings.length).toBe(20);
    expect(limited.length).toBe(40);
  });

  it("respects limits across multiple hexes", () => {
    const buildings = [];
    // Building spans both hexes
    for (let i = 0; i < 25; i++) {
      buildings.push(makeBuilding(`building-${i}`, "food", ["hex-1", "hex-2"], 100 - i));
    }

    const limited = limitBuildingsPerHex(buildings, 20);

    expect(limited.length).toBe(20);
  });

  it("rejects multi-hex building if any hex is at limit", () => {
    const buildings = [];
    // Fill hex-1 to limit with single-hex buildings
    for (let i = 0; i < 20; i++) {
      buildings.push(makeBuilding(`hex1-only-${i}`, "food", ["hex-1"], 200 - i));
    }
    // Try to add a building that spans hex-1 (full) and hex-2 (empty)
    buildings.push(makeBuilding("multi-hex", "food", ["hex-1", "hex-2"], 50));

    const limited = limitBuildingsPerHex(buildings, 20);

    // Multi-hex building should be rejected because hex-1 is at limit
    expect(limited.length).toBe(20);
    expect(limited.find(b => b.id === "multi-hex")).toBeUndefined();
  });

  it("keeps buildings without resources unlimited", () => {
    const buildings = [
      {
        id: "no-resource-1",
        xmin: 0, ymin: 0, xmax: 1, ymax: 1,
        categories: null,
        resources: { food: false, equipment: false, energy: false, materials: false, cat: null },
        weight: 1,
        area: 0.001,
        cells: ["hex-1"]
      },
      {
        id: "no-resource-2",
        xmin: 0, ymin: 0, xmax: 1, ymax: 1,
        categories: null,
        resources: { food: false, equipment: false, energy: false, materials: false, cat: null },
        weight: 2,
        area: 0.001,
        cells: ["hex-1"]
      }
    ];

    const limited = limitBuildingsPerHex(buildings, 1);

    expect(limited.length).toBe(2);
  });
});

describe("interpolateLineString", () => {
  it("returns [0, 0] for empty coords", () => {
    expect(interpolateLineString([], 0.5)).toEqual([0, 0]);
  });

  it("returns the single point for single-point coords", () => {
    expect(interpolateLineString([[10, 20]], 0.5)).toEqual([10, 20]);
  });

  it("returns start point for t <= 0", () => {
    const coords = [[0, 0], [10, 10]];
    expect(interpolateLineString(coords, 0)).toEqual([0, 0]);
    expect(interpolateLineString(coords, -1)).toEqual([0, 0]);
  });

  it("returns end point for t >= 1", () => {
    const coords = [[0, 0], [10, 10]];
    expect(interpolateLineString(coords, 1)).toEqual([10, 10]);
    expect(interpolateLineString(coords, 2)).toEqual([10, 10]);
  });

  it("interpolates midpoint on a two-point line", () => {
    const coords = [[0, 0], [10, 20]];
    const result = interpolateLineString(coords, 0.5);
    expect(result[0]).toBeCloseTo(5);
    expect(result[1]).toBeCloseTo(10);
  });

  it("interpolates at 25% on a two-point line", () => {
    const coords = [[0, 0], [100, 0]];
    const result = interpolateLineString(coords, 0.25);
    expect(result[0]).toBeCloseTo(25);
    expect(result[1]).toBeCloseTo(0);
  });

  it("interpolates correctly on a multi-segment line", () => {
    // Three points forming an L-shape: (0,0) -> (10,0) -> (10,10)
    // First segment length: 10, second segment length: 10, total: 20
    const coords = [[0, 0], [10, 0], [10, 10]];

    // t=0.25 should be at (5, 0) - quarter of total distance
    const result1 = interpolateLineString(coords, 0.25);
    expect(result1[0]).toBeCloseTo(5);
    expect(result1[1]).toBeCloseTo(0);

    // t=0.5 should be at (10, 0) - exactly at the corner
    const result2 = interpolateLineString(coords, 0.5);
    expect(result2[0]).toBeCloseTo(10);
    expect(result2[1]).toBeCloseTo(0);

    // t=0.75 should be at (10, 5) - three quarters of total distance
    const result3 = interpolateLineString(coords, 0.75);
    expect(result3[0]).toBeCloseTo(10);
    expect(result3[1]).toBeCloseTo(5);
  });

  it("handles unequal segment lengths", () => {
    // (0,0) -> (30,0) -> (30,10): first segment 30, second segment 10, total 40
    const coords = [[0, 0], [30, 0], [30, 10]];

    // t=0.5 is at distance 20, which is still in first segment at (20, 0)
    const result = interpolateLineString(coords, 0.5);
    expect(result[0]).toBeCloseTo(20);
    expect(result[1]).toBeCloseTo(0);
  });
});
