export type Bbox = {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
};

export type RegionConfig = {
  regionId: string;
  regionName: string;
  bbox: Bbox;
};

export const BOSTON_BBOX: Bbox = {
  xmin: -71.1912,
  ymin: 42.2279,
  xmax: -70.9201,
  ymax: 42.3974,
};

export const BAR_HARBOR_DEMO_BBOX: Bbox = {
  xmin: -68.30,
  ymin: 44.35,
  xmax: -68.20,
  ymax: 44.42,
};

export const H3_RESOLUTION = 7;

export type RoadClassInfo = {
  decayRate: number;
  costLabor: number;
  costMaterials: number;
  durationS: number;
  repairAmount: number;
  priorityWeight: number;
};

export const ROAD_CLASSES: Record<string, RoadClassInfo> = {
  motorway: {
    decayRate: 0.5,
    costLabor: 100,
    costMaterials: 100,
    durationS: 120,
    repairAmount: 30,
    priorityWeight: 10
  },
  trunk: {
    decayRate: 0.6,
    costLabor: 80,
    costMaterials: 80,
    durationS: 100,
    repairAmount: 30,
    priorityWeight: 8
  },
  primary: {
    decayRate: 0.8,
    costLabor: 60,
    costMaterials: 60,
    durationS: 80,
    repairAmount: 25,
    priorityWeight: 6
  },
  secondary: {
    decayRate: 1.0,
    costLabor: 40,
    costMaterials: 40,
    durationS: 60,
    repairAmount: 25,
    priorityWeight: 4
  },
  tertiary: {
    decayRate: 1.2,
    costLabor: 30,
    costMaterials: 30,
    durationS: 50,
    repairAmount: 20,
    priorityWeight: 3
  },
  residential: {
    decayRate: 1.5,
    costLabor: 20,
    costMaterials: 20,
    durationS: 40,
    repairAmount: 20,
    priorityWeight: 2
  },
  service: {
    decayRate: 2.0,
    costLabor: 10,
    costMaterials: 10,
    durationS: 30,
    repairAmount: 15,
    priorityWeight: 1
  }
};

export const ROAD_CLASS_FILTER = Object.keys(ROAD_CLASSES);

export const REGION_CONFIGS: Record<string, RegionConfig> = {
  boston_ma_usa: {
    regionId: "boston_ma_usa",
    regionName: "Boston, MA, USA",
    bbox: BOSTON_BBOX
  },
  bar_harbor_me_usa_demo: {
    regionId: "bar_harbor_me_usa_demo",
    regionName: "Bar Harbor, ME, USA (Demo)",
    bbox: BAR_HARBOR_DEMO_BBOX
  }
};