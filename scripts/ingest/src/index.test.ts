import { afterEach, describe, expect, it } from "vitest";
import {
  buildRoadsQuery,
  buildBuildingsQuery,
  buildBuildingsUpsertQuery,
  applyResourceFallback,
  getRegionConfig,
  getResourcesFromCategories,
  H3_RESOLUTION,
  normalizeCategories,
  ROAD_CLASS_FILTER,
  REGION_CONFIGS,
  shouldSeedDemo
} from "./index";

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
    expect(query).toContain("generates_labor = EXCLUDED.generates_labor");
    expect(query).toContain("generates_materials = EXCLUDED.generates_materials");
  });
});

describe("category resource mapping", () => {
  it("matches labor from alternates", () => {
    const categories = { primary: "museum", alternate: ["food_court"] };
    const res = getResourcesFromCategories(categories);

    expect(res.labor).toBe(true);
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

  it("matches materials from hardware and home improvement categories", () => {
    const categories = [
      { primary: "hardware_store", alternate: null },
      { primary: "home_improvement_store", alternate: ["garden_center"] }
    ];
    const res = getResourcesFromCategories(categories);

    expect(res.materials).toBe(true);
    expect(res.labor).toBe(false);
  });
});

describe("fallback resource assignment", () => {
  it("assigns labor or materials for a deterministic slice of ids", () => {
    let fallbackFound = false;
    for (let i = 0; i < 1000; i += 1) {
      const id = `fallback-test-${i}`;
      const res = applyResourceFallback(id, { labor: false, materials: false, cat: null });
      if (res.labor || res.materials) {
        fallbackFound = true;
        break;
      }
    }

    expect(fallbackFound).toBe(true);
  });

  it("does not override existing resource flags", () => {
    const res = applyResourceFallback("fallback-test-override", {
      labor: true,
      materials: false,
      cat: "cafe"
    });

    expect(res.labor).toBe(true);
    expect(res.materials).toBe(false);
  });
});
