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

// Roads are considered "degraded" when health falls below this threshold
export const DEGRADED_HEALTH_THRESHOLD = 70;

// Health bucket size for SSE delta filtering (only emit when crossing a bucket boundary)
export const HEALTH_BUCKET_SIZE = 10;

export type ResourceType = "food" | "equipment" | "energy" | "materials";

export const RESOURCE_TYPES: ResourceType[] = ["food", "equipment", "energy", "materials"];

export type RoadClassInfo = {
  decayRate: number;
  costFood: number;
  costEquipment: number;
  costEnergy: number;
  costMaterials: number;
  durationS: number;
  repairAmount: number;
  priorityWeight: number;
};

export const ROAD_CLASSES: Record<string, RoadClassInfo> = {
  motorway: {
    decayRate: 0.5,
    costFood: 30,
    costEquipment: 60,
    costEnergy: 45,
    costMaterials: 75,
    durationS: 8,
    repairAmount: 30,
    priorityWeight: 10
  },
  trunk: {
    decayRate: 0.6,
    costFood: 26,
    costEquipment: 45,
    costEnergy: 38,
    costMaterials: 60,
    durationS: 7,
    repairAmount: 30,
    priorityWeight: 8
  },
  primary: {
    decayRate: 0.8,
    costFood: 19,
    costEquipment: 34,
    costEnergy: 26,
    costMaterials: 45,
    durationS: 6,
    repairAmount: 25,
    priorityWeight: 6
  },
  secondary: {
    decayRate: 1.0,
    costFood: 15,
    costEquipment: 23,
    costEnergy: 19,
    costMaterials: 30,
    durationS: 5,
    repairAmount: 25,
    priorityWeight: 4
  },
  tertiary: {
    decayRate: 1.2,
    costFood: 11,
    costEquipment: 19,
    costEnergy: 15,
    costMaterials: 23,
    durationS: 4,
    repairAmount: 20,
    priorityWeight: 3
  },
  residential: {
    decayRate: 1.5,
    costFood: 8,
    costEquipment: 11,
    costEnergy: 9,
    costMaterials: 15,
    durationS: 3,
    repairAmount: 20,
    priorityWeight: 2
  },
  service: {
    decayRate: 2.0,
    costFood: 4,
    costEquipment: 6,
    costEnergy: 5,
    costMaterials: 8,
    durationS: 3,
    repairAmount: 15,
    priorityWeight: 1
  }
};

// Validate road class names are safe for SQL interpolation (defense in depth)
const VALID_ROAD_CLASS = /^[a-z_]+$/;
Object.keys(ROAD_CLASSES).forEach(cls => {
  if (!VALID_ROAD_CLASS.test(cls)) {
    throw new Error(`Invalid road class name: ${cls}. Must match /^[a-z_]+$/`);
  }
});

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