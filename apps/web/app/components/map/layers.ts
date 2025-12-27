import type maplibregl from "maplibre-gl";
import { ROAD_CLASS_FILTER } from "@nightfall/config";
import { COLORS, CREW_COLORS, RUST_FILL_OPACITY_BASE, RUST_LINE_OPACITY_BASE } from "./mapConfig";

// Base road filter - roads in our class list
export const BASE_ROAD_FILTER: maplibregl.FilterSpecification = ["all",
  ["==", ["get", "subtype"], "road"],
  ["in", ["get", "class"], ["literal", ROAD_CLASS_FILTER]]
];

// Filter for roads that have routes OR have route-like names
export const HAS_ROUTE_FILTER: maplibregl.FilterSpecification = ["any",
  ["all",
    ["has", "routes"],
    ["!=", ["get", "routes"], "[]"],
    ["!=", ["get", "routes"], null]
  ],
  ["any",
    ["in", "Route", ["coalesce", ["get", "primary"], ""]],
    ["in", "Highway", ["coalesce", ["get", "primary"], ""]],
    ["in", "US-", ["coalesce", ["get", "primary"], ""]],
    ["in", "SR-", ["coalesce", ["get", "primary"], ""]],
    ["in", "State Route", ["coalesce", ["get", "primary"], ""]]
  ]
];

export function getBaseLayers(): maplibregl.LayerSpecification[] {
  return [
    {
      id: "background",
      type: "background",
      paint: { "background-color": COLORS.background }
    },
    {
      id: "landuse",
      source: "overture_base",
      "source-layer": "land_use",
      type: "fill",
      paint: { "fill-color": COLORS.landuse }
    },
    {
      id: "water",
      source: "overture_base",
      "source-layer": "water",
      type: "fill",
      paint: { "fill-color": COLORS.water }
    },
    {
      id: "water-outline",
      source: "overture_base",
      "source-layer": "water",
      type: "line",
      paint: {
        "line-color": COLORS.waterOutline,
        "line-width": 1,
        "line-opacity": 0.5
      }
    },
    {
      id: "buildings",
      source: "overture_buildings",
      "source-layer": "building",
      type: "fill",
      paint: {
        "fill-color": COLORS.buildings,
        "fill-opacity": 0.9,
        "fill-outline-color": COLORS.buildingOutline
      }
    },
    {
      id: "buildings-labor",
      source: "overture_buildings",
      "source-layer": "building",
      type: "fill",
      filter: ["==", ["get", "id"], "none"],
      paint: {
        "fill-color": COLORS.buildingsLabor,
        "fill-opacity": 0.85,
        "fill-outline-color": COLORS.buildingOutline
      }
    },
    {
      id: "buildings-materials",
      source: "overture_buildings",
      "source-layer": "building",
      type: "fill",
      filter: ["==", ["get", "id"], "none"],
      paint: {
        "fill-color": COLORS.buildingsMaterials,
        "fill-opacity": 0.85,
        "fill-outline-color": COLORS.buildingOutline
      }
    },
    {
      id: "buildings-hub-glow",
      source: "overture_buildings",
      "source-layer": "building",
      type: "fill",
      filter: ["==", ["get", "id"], "none"],
      paint: {
        "fill-color": "#ffffff",
        "fill-opacity": 0.3
      }
    },
    {
      id: "buildings-hub",
      source: "overture_buildings",
      "source-layer": "building",
      type: "line",
      filter: ["==", ["get", "id"], "none"],
      paint: {
        "line-color": "#ffffff",
        "line-width": 3,
        "line-opacity": 0.95
      }
    }
  ];
}

export function getRoadLayers(): maplibregl.LayerSpecification[] {
  return [
    {
      id: "roads-routes",
      source: "overture_transportation",
      "source-layer": "segment",
      type: "line",
      minzoom: 8,
      maxzoom: 13,
      filter: ["all",
        ["==", ["get", "subtype"], "road"],
        HAS_ROUTE_FILTER
      ] as maplibregl.FilterSpecification,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": COLORS.roadsRoute,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 13, 2]
      }
    },
    {
      id: "roads-low",
      source: "overture_transportation",
      "source-layer": "segment",
      type: "line",
      minzoom: 13,
      filter: ["all", BASE_ROAD_FILTER, ["in", ["get", "class"], ["literal", ["residential", "service"]]]] as maplibregl.FilterSpecification,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": COLORS.roadsLow,
        "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.5, 16, 1.5]
      }
    },
    {
      id: "roads-mid",
      source: "overture_transportation",
      "source-layer": "segment",
      type: "line",
      minzoom: 10,
      filter: ["any",
        ["all", BASE_ROAD_FILTER, ["in", ["get", "class"], ["literal", ["primary", "secondary", "tertiary"]]]],
        ["all",
          ["==", ["get", "subtype"], "road"],
          HAS_ROUTE_FILTER
        ]
      ] as maplibregl.FilterSpecification,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": COLORS.roadsMid,
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 16, 2.5]
      }
    },
    {
      id: "roads-high",
      source: "overture_transportation",
      "source-layer": "segment",
      type: "line",
      minzoom: 6,
      filter: ["all", BASE_ROAD_FILTER, ["in", ["get", "class"], ["literal", ["motorway", "trunk"]]]] as maplibregl.FilterSpecification,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": COLORS.roadsHigh,
        "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.5, 10, 1.5, 16, 3]
      }
    }
  ];
}

export function getGameStateLayers(): maplibregl.LayerSpecification[] {
  return [
    {
      id: "game-roads-healthy-glow",
      source: "overture_transportation",
      "source-layer": "segment",
      type: "line",
      filter: ["all", BASE_ROAD_FILTER, ["==", ["get", "id"], "none"]] as maplibregl.FilterSpecification,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": COLORS.healthy,
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 6, 16, 14],
        "line-blur": 4,
        "line-opacity": 0.15
      }
    },
    {
      id: "game-roads-healthy",
      source: "overture_transportation",
      "source-layer": "segment",
      type: "line",
      filter: ["all", BASE_ROAD_FILTER, ["==", ["get", "id"], "none"]] as maplibregl.FilterSpecification,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": COLORS.healthy,
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.5, 16, 4],
        "line-opacity": 0.7
      }
    },
    {
      id: "game-roads-warning-glow",
      source: "overture_transportation",
      "source-layer": "segment",
      type: "line",
      filter: ["all", BASE_ROAD_FILTER, ["==", ["get", "id"], "none"]] as maplibregl.FilterSpecification,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": COLORS.warning,
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 7, 16, 16],
        "line-blur": 4,
        "line-opacity": 0.2
      }
    },
    {
      id: "game-roads-warning",
      source: "overture_transportation",
      "source-layer": "segment",
      type: "line",
      filter: ["all", BASE_ROAD_FILTER, ["==", ["get", "id"], "none"]] as maplibregl.FilterSpecification,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": COLORS.warning,
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.8, 16, 5],
        "line-opacity": 0.8
      }
    },
    {
      id: "game-roads-degraded-glow",
      source: "overture_transportation",
      "source-layer": "segment",
      type: "line",
      filter: ["all", BASE_ROAD_FILTER, ["==", ["get", "id"], "none"]] as maplibregl.FilterSpecification,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": COLORS.degraded,
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 8, 16, 18],
        "line-blur": 5,
        "line-opacity": 0.25
      }
    },
    {
      id: "game-roads-degraded",
      source: "overture_transportation",
      "source-layer": "segment",
      type: "line",
      filter: ["all", BASE_ROAD_FILTER, ["==", ["get", "id"], "none"]] as maplibregl.FilterSpecification,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": COLORS.degraded,
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2, 16, 6],
        "line-opacity": 0.9
      }
    }
  ];
}

export function getTaskHighlightLayers(): maplibregl.LayerSpecification[] {
  return [
    {
      id: "game-roads-task-highlight-glow",
      source: "overture_transportation",
      "source-layer": "segment",
      type: "line",
      filter: ["all", BASE_ROAD_FILTER, ["==", ["get", "id"], "none"]] as maplibregl.FilterSpecification,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#f0ddc2",
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 6, 16, 14],
        "line-blur": 4,
        "line-opacity": 0.25
      }
    },
    {
      id: "game-roads-task-highlight-dash",
      source: "overture_transportation",
      "source-layer": "segment",
      type: "line",
      filter: ["all", BASE_ROAD_FILTER, ["==", ["get", "id"], "none"]] as maplibregl.FilterSpecification,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#ffffff",
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2, 16, 4],
        "line-dasharray": [2, 3],
        "line-opacity": 0.6
      }
    }
  ];
}

export function getRepairAndCompletionLayers(): maplibregl.LayerSpecification[] {
  return [
    {
      id: "game-roads-repair-pulse",
      source: "overture_transportation",
      "source-layer": "segment",
      type: "line",
      filter: ["==", ["get", "id"], "none"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#3eb0c0",
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 10, 16, 24],
        "line-blur": 8,
        "line-opacity": 0.4
      }
    },
    {
      id: "game-roads-completion-flash",
      source: "overture_transportation",
      "source-layer": "segment",
      type: "line",
      filter: ["==", ["get", "id"], "none"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#ffffff",
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 20, 16, 40],
        "line-blur": 12,
        "line-opacity": 0.8
      }
    }
  ];
}

export function getInteractionLayers(): maplibregl.LayerSpecification[] {
  return [
    {
      id: "game-feature-hover",
      source: "overture_transportation",
      "source-layer": "segment",
      type: "line",
      filter: ["==", ["get", "id"], ""],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": COLORS.selection,
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 3, 16, 7],
        "line-opacity": 0.25
      }
    },
    {
      id: "game-feature-selection-glow",
      source: "overture_transportation",
      "source-layer": "segment",
      type: "line",
      filter: ["==", ["get", "id"], "none"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": COLORS.selection,
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 12, 16, 24],
        "line-blur": 6,
        "line-opacity": 0.3
      }
    },
    {
      id: "game-feature-selection",
      source: "overture_transportation",
      "source-layer": "segment",
      type: "line",
      filter: ["==", ["get", "id"], "none"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": COLORS.selection,
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2, 16, 5],
        "line-opacity": 0.9
      }
    }
  ];
}

export function getAllInitialLayers(): maplibregl.LayerSpecification[] {
  return [
    ...getBaseLayers(),
    ...getRoadLayers(),
    ...getGameStateLayers(),
    ...getTaskHighlightLayers(),
    ...getRepairAndCompletionLayers(),
    ...getInteractionLayers()
  ];
}

// Dynamic layers added after map load
export function getHexLayers(): { fill: maplibregl.LayerSpecification; outline: maplibregl.LayerSpecification } {
  return {
    fill: {
      id: "game-hex-fill",
      type: "fill",
      source: "game-hexes",
      paint: {
        "fill-color": [
          "interpolate",
          ["linear"],
          ["get", "rust_level"],
          0, COLORS.healthy,
          0.5, COLORS.warning,
          1, COLORS.degraded
        ],
        "fill-color-transition": { duration: 1500, delay: 0 },
        "fill-opacity": RUST_FILL_OPACITY_BASE,
        "fill-opacity-transition": { duration: 1500, delay: 0 }
      }
    },
    outline: {
      id: "game-hex-outline",
      type: "line",
      source: "game-hexes",
      paint: {
        "line-color": [
          "interpolate",
          ["linear"],
          ["get", "rust_level"],
          0, COLORS.healthy,
          0.5, COLORS.warning,
          1, COLORS.degraded
        ],
        "line-color-transition": { duration: 1500, delay: 0 },
        "line-width": [
          "interpolate",
          ["linear"],
          ["get", "rust_level"],
          0, 1,
          0.5, 1.2,
          1, 2
        ],
        "line-width-transition": { duration: 1500, delay: 0 },
        "line-opacity": RUST_LINE_OPACITY_BASE,
        "line-opacity-transition": { duration: 1500, delay: 0 }
      }
    }
  };
}

export function getCrewLayers(): maplibregl.LayerSpecification[] {
  return [
    {
      id: "game-crews-glow",
      type: "circle",
      source: "game-crews",
      filter: ["==", ["get", "status"], "working"],
      paint: {
        "circle-radius": 16,
        "circle-color": CREW_COLORS.working,
        "circle-blur": 1,
        "circle-opacity": 0.4
      }
    },
    {
      id: "game-crews-point",
      type: "circle",
      source: "game-crews",
      paint: {
        "circle-radius": 8,
        "circle-color": [
          "match",
          ["get", "status"],
          "idle", CREW_COLORS.idle,
          "traveling", CREW_COLORS.traveling,
          "working", CREW_COLORS.working,
          "returning", CREW_COLORS.returning,
          "#ffffff"
        ],
        "circle-stroke-width": 3,
        "circle-stroke-color": "#ffffff",
        "circle-opacity": 0.9
      }
    }
  ];
}

export function getCentralHubLayers(): maplibregl.LayerSpecification[] {
  return [
    {
      id: "game-central-hub-glow",
      type: "circle",
      source: "game-central-hub",
      paint: {
        "circle-radius": 22,
        "circle-color": "#f0ddc2",
        "circle-blur": 0.8,
        "circle-opacity": 0.35
      }
    },
    {
      id: "game-central-hub-core",
      type: "circle",
      source: "game-central-hub",
      paint: {
        "circle-radius": 6,
        "circle-color": "#ffffff",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#f0ddc2",
        "circle-opacity": 0.9
      }
    }
  ];
}

export function getCrewPathLayers(): maplibregl.LayerSpecification[] {
  return [
    {
      id: "game-crew-path-line",
      type: "line",
      source: "game-crew-paths",
      paint: {
        "line-color": "#f0ddc2",
        "line-width": 2,
        "line-dasharray": [2, 2],
        "line-opacity": 0.6
      }
    },
    {
      id: "game-crew-path-head",
      type: "circle",
      source: "game-crew-markers",
      paint: {
        "circle-radius": 6,
        "circle-color": CREW_COLORS.traveling,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
        "circle-opacity": 0.9
      }
    }
  ];
}

export function getResourcePackageLayers(): maplibregl.LayerSpecification[] {
  return [
    {
      id: "game-resource-trail",
      type: "line",
      source: "game-resource-packages",
      filter: ["==", ["get", "featureType"], "trail"],
      paint: {
        "line-color": [
          "match",
          ["get", "resourceType"],
          "labor", "#3eb0c0",
          "materials", "#f08a4e",
          "#ffffff"
        ],
        "line-width": 3,
        "line-opacity": 0.4,
        "line-dasharray": [2, 2]
      }
    },
    {
      id: "game-resource-package-glow",
      type: "circle",
      source: "game-resource-packages",
      filter: ["==", ["get", "featureType"], "package"],
      paint: {
        "circle-radius": 14,
        "circle-color": [
          "match",
          ["get", "resourceType"],
          "labor", "#3eb0c0",
          "materials", "#f08a4e",
          "#ffffff"
        ],
        "circle-blur": 1,
        "circle-opacity": ["get", "opacity"]
      }
    },
    {
      id: "game-resource-package",
      type: "circle",
      source: "game-resource-packages",
      filter: ["==", ["get", "featureType"], "package"],
      paint: {
        "circle-radius": 6,
        "circle-color": [
          "match",
          ["get", "resourceType"],
          "labor", "#3eb0c0",
          "materials", "#f08a4e",
          "#ffffff"
        ],
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
        "circle-opacity": ["get", "opacity"]
      }
    }
  ];
}
