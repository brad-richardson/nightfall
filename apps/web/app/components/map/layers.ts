import type maplibregl from "maplibre-gl";
import { ROAD_CLASS_FILTER, CRITICAL_HEALTH_THRESHOLD } from "@nightfall/config";
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
        "line-width": 1.5,
        "line-opacity": 0.7
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
      id: "buildings-food",
      source: "overture_buildings",
      "source-layer": "building",
      type: "fill",
      filter: ["==", ["get", "id"], "none"],
      paint: {
        "fill-color": COLORS.buildingsFood,
        "fill-opacity": 0.85,
        "fill-outline-color": COLORS.buildingOutline
      }
    },
    {
      id: "buildings-equipment",
      source: "overture_buildings",
      "source-layer": "building",
      type: "fill",
      filter: ["==", ["get", "id"], "none"],
      paint: {
        "fill-color": COLORS.buildingsEquipment,
        "fill-opacity": 0.85,
        "fill-outline-color": COLORS.buildingOutline
      }
    },
    {
      id: "buildings-energy",
      source: "overture_buildings",
      "source-layer": "building",
      type: "fill",
      filter: ["==", ["get", "id"], "none"],
      paint: {
        "fill-color": COLORS.buildingsEnergy,
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
      id: "buildings-boost-glow",
      source: "overture_buildings",
      "source-layer": "building",
      type: "fill",
      filter: ["==", ["get", "id"], "none"],
      paint: {
        "fill-color": "#facc15",
        "fill-opacity": 0.4
      }
    },
    {
      id: "buildings-boost-outline",
      source: "overture_buildings",
      "source-layer": "building",
      type: "line",
      filter: ["==", ["get", "id"], "none"],
      paint: {
        "line-color": "#facc15",
        "line-width": 2,
        "line-opacity": 0.9
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

export function getAllInitialLayers(hasOvertureSources = true): maplibregl.LayerSpecification[] {
  // Always include background layer
  const layers: maplibregl.LayerSpecification[] = [
    { id: "background", type: "background", paint: { "background-color": COLORS.background } }
  ];

  // Only include layers that depend on Overture sources when they're available
  if (hasOvertureSources) {
    // Add Overture-dependent base layers (skip background, it's already added)
    layers.push(...getBaseLayers().filter(l => l.id !== "background"));
    layers.push(...getRoadLayers());
    layers.push(...getGameStateLayers());
    layers.push(...getTaskHighlightLayers());
    layers.push(...getRepairAndCompletionLayers());
    layers.push(...getInteractionLayers());
  }

  return layers;
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
    // Subtle shadow under crew badge
    {
      id: "game-crews-shadow",
      type: "circle",
      source: "game-crews",
      paint: {
        "circle-radius": 22,
        "circle-color": "#000000",
        "circle-blur": 0.8,
        "circle-opacity": 0.3,
        "circle-translate": [2, 2]
      }
    },
    // Working pulse effect - construction orange, not circular glow
    {
      id: "game-crews-working-pulse",
      type: "circle",
      source: "game-crews",
      filter: ["==", ["get", "status"], "working"],
      paint: {
        "circle-radius": 26,
        "circle-color": CREW_COLORS.working,
        "circle-blur": 0.6,
        "circle-opacity": 0.4
      }
    },
    // Construction crew badge icon - no rotation, stays upright
    {
      id: "game-crews-icon",
      type: "symbol",
      source: "game-crews",
      layout: {
        "icon-image": "construction-vehicle",
        "icon-size": 1.0,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true
        // No rotation - badge stays upright, path line shows direction
      },
      paint: {
        "icon-opacity": 1
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
    // Path line (dashed trail) - construction orange color
    {
      id: "game-crew-path-line",
      type: "line",
      source: "game-crew-paths",
      paint: {
        "line-color": "#FF9800",
        "line-width": 3,
        "line-dasharray": [2, 2],
        "line-opacity": 0.5
      }
    },
    // Shadow under moving crew badge
    {
      id: "game-crew-path-shadow",
      type: "circle",
      source: "game-crew-markers",
      paint: {
        "circle-radius": 22,
        "circle-color": "#000000",
        "circle-blur": 0.8,
        "circle-opacity": 0.3,
        "circle-translate": [2, 2]
      }
    },
    // Moving crew badge icon - no rotation, stays upright
    {
      id: "game-crew-path-icon",
      type: "symbol",
      source: "game-crew-markers",
      layout: {
        "icon-image": "construction-vehicle",
        "icon-size": 1.0,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true
        // No rotation - badge stays upright, path line shows direction
      },
      paint: {
        "icon-opacity": 1
      }
    }
  ];
}

export function getResourcePackageLayers(): maplibregl.LayerSpecification[] {
  return [
    // Trail for regular (non-boosted) convoys - dashed
    {
      id: "game-resource-trail",
      type: "line",
      source: "game-resource-packages",
      filter: ["all", ["==", ["get", "featureType"], "trail"], ["!=", ["get", "boosted"], true]],
      paint: {
        "line-color": [
          "match",
          ["get", "resourceType"],
          "food", COLORS.buildingsFood,
          "equipment", COLORS.buildingsEquipment,
          "energy", COLORS.buildingsEnergy,
          "materials", COLORS.buildingsMaterials,
          "#ffffff"
        ],
        "line-width": 3,
        "line-opacity": 0.4,
        "line-dasharray": [2, 2]
      }
    },
    // Trail for boosted convoys - solid, wider, brighter
    {
      id: "game-resource-trail-boosted",
      type: "line",
      source: "game-resource-packages",
      filter: ["all", ["==", ["get", "featureType"], "trail"], ["==", ["get", "boosted"], true]],
      paint: {
        "line-color": [
          "match",
          ["get", "resourceType"],
          "food", COLORS.buildingsFood,
          "equipment", COLORS.buildingsEquipment,
          "energy", COLORS.buildingsEnergy,
          "materials", COLORS.buildingsMaterials,
          "#ffffff"
        ],
        "line-width": 4,
        "line-opacity": 0.7
        // Solid line (no dasharray) for boosted convoys
      }
    },
    // Outer boost aura - only for boosted packages (pulsing effect via larger radius)
    {
      id: "game-resource-package-boost-aura",
      type: "circle",
      source: "game-resource-packages",
      filter: ["all", ["==", ["get", "featureType"], "package"], ["==", ["get", "boosted"], true]],
      paint: {
        "circle-radius": 22,
        "circle-color": "#ffffff",
        "circle-blur": 1.5,
        "circle-opacity": ["*", ["get", "opacity"], 0.3]
      }
    },
    {
      id: "game-resource-package-glow",
      type: "circle",
      source: "game-resource-packages",
      filter: ["==", ["get", "featureType"], "package"],
      paint: {
        // Boosted packages get a larger glow
        "circle-radius": [
          "case",
          ["==", ["get", "boosted"], true], 18,
          14
        ],
        "circle-color": [
          "match",
          ["get", "resourceType"],
          "food", COLORS.buildingsFood,
          "equipment", COLORS.buildingsEquipment,
          "energy", COLORS.buildingsEnergy,
          "materials", COLORS.buildingsMaterials,
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
          "food", COLORS.buildingsFood,
          "equipment", COLORS.buildingsEquipment,
          "energy", COLORS.buildingsEnergy,
          "materials", COLORS.buildingsMaterials,
          "#ffffff"
        ],
        // Boosted packages have a thicker white stroke
        "circle-stroke-width": [
          "case",
          ["==", ["get", "boosted"], true], 3,
          2
        ],
        "circle-stroke-color": "#ffffff",
        "circle-opacity": ["get", "opacity"],
        "circle-stroke-opacity": ["get", "opacity"]
      }
    }
  ];
}

/**
 * Backbone road overlay layers.
 * These render tier 1 roads from the computed backbone network
 * to supplement PMTiles styling and fill visual gaps.
 *
 * Positioned below other game layers but above base tiles.
 * Uses same health threshold as main road layers (CRITICAL_HEALTH_THRESHOLD = 30).
 */
export function getBackboneLayers(): maplibregl.LayerSpecification[] {
  return [
    // Backbone road outline (slightly darker, for depth)
    {
      id: "game-backbone-outline",
      type: "line",
      source: "game-backbone",
      paint: {
        "line-color": "#1a1f28",
        "line-width": 4,
        "line-opacity": 0.8
      }
    },
    // Backbone road fill with health-based coloring
    // Uses same binary threshold as game-roads layers: > 30 = healthy, <= 30 = degraded
    {
      id: "game-backbone-fill",
      type: "line",
      source: "game-backbone",
      paint: {
        "line-color": [
          "step",
          ["get", "health"],
          COLORS.degraded,                    // health <= threshold = red
          CRITICAL_HEALTH_THRESHOLD + 0.01,   // Just above 30
          COLORS.healthy                      // health > threshold = teal
        ],
        "line-width": 2.5,
        "line-opacity": 0.85
      }
    }
  ];
}
