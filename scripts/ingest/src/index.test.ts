import { afterEach, describe, expect, it } from "vitest";
import {
  buildRoadsQuery,
  getRegionConfig,
  H3_RESOLUTION,
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
    expect(classList).toContain("'track'");
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
      "track"
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
