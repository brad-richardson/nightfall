"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import * as pmtiles from "pmtiles";
import { cellToBoundary, latLngToCell } from "h3-js";
import { ROAD_CLASS_FILTER } from "@nightfall/config";
import {
  type ResourcePackage,
  buildResourcePath,
  interpolatePath,
  easeInOutCubic
} from "../lib/resourceAnimation";

type Feature = {
  gers_id: string;
  feature_type: string;
  bbox: [number, number, number, number] | null;
  geometry?: {
    type: "Point" | "LineString" | "Polygon" | "MultiPolygon";
    coordinates: number[] | number[][] | number[][][] | number[][][][];
  } | null;
  health?: number | null;
  status?: string | null;
  road_class?: string | null;
  generates_labor?: boolean;
  generates_materials?: boolean;
  is_hub?: boolean;
};

type Crew = {
  crew_id: string;
  status: string;
  active_task_id: string | null;
};

type Task = {
  task_id: string;
  target_gers_id: string;
  status?: string;
};

type Hex = {
  h3_index: string;
  rust_level: number;
};

type Boundary =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

type Bbox = {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
};

type DemoMapProps = {
  boundary: Boundary | null;
  features: Feature[];
  hexes: Hex[];
  crews: Crew[];
  tasks: Task[];
  fallbackBbox: Bbox;
  cycle: {
    phase: "dawn" | "day" | "dusk" | "night";
    phase_progress: number;
  };
  pmtilesRelease: string;
};

// Crew status colors
const CREW_COLORS = {
  idle: "#888888",
  traveling: "#f0ddc2",
  working: "#3eb0c0",
  returning: "#f08a4e"
};

const DEFAULT_RELEASE = "2025-12-17";

const PHASE_FILTERS = {
  dawn: "brightness(1.05) saturate(0.9) contrast(1.1)",
  day: "brightness(1.0) saturate(1.0) contrast(1.0)",
  dusk: "brightness(0.85) saturate(0.8) sepia(0.15) contrast(1.15)",
  night: "brightness(0.7) saturate(0.6) sepia(0.3) contrast(1.25)"
};

// Color palette - improved contrast
const COLORS = {
  background: "#101216",
  landuse: "#14181e",
  water: "#0a1520",
  waterOutline: "#1a2a3a",
  buildings: "#1a1f28",
  buildingOutline: "#2a3040",
  buildingsLabor: "#3eb0c0",
  buildingsMaterials: "#f08a4e",
  roadsLow: "#252530",
  roadsMid: "#2a3040",
  roadsHigh: "#353a4a",
  roadsRoute: "#2a3545",
  healthy: "#3eb0c0",
  warning: "#f08a4e",
  degraded: "#e03a30",
  selection: "#ffffff"
};

export default function DemoMap({
  boundary,
  features,
  hexes,
  crews,
  tasks,
  fallbackBbox,
  cycle,
  pmtilesRelease
}: DemoMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [resourcePackages, setResourcePackages] = useState<ResourcePackage[]>([]);
  const repairPulseRef = useRef<number | null>(null);
  const resourceAnimationRef = useRef<number | null>(null);
  const pmtilesBase = useMemo(
    () => `https://d3c1b7bog2u1nn.cloudfront.net/${pmtilesRelease || DEFAULT_RELEASE}`,
    [pmtilesRelease]
  );

  // Get IDs of roads currently being repaired (in_progress tasks)
  const repairingRoadIds = useMemo(() => {
    return tasks
      .filter(t => t.status === 'in_progress')
      .map(t => {
        const task = tasks.find(task => task.task_id === t.task_id);
        return task?.target_gers_id;
      })
      .filter((id): id is string => Boolean(id));
  }, [tasks]);

  useEffect(() => {
    if (!mapContainer.current) return;

    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);

    const centerLon = (fallbackBbox.xmin + fallbackBbox.xmax) / 2;
    const centerLat = (fallbackBbox.ymin + fallbackBbox.ymax) / 2;

    // Calculate maxBounds from boundary if available
    let maxBounds: maplibregl.LngLatBoundsLike | undefined = undefined;
    if (boundary) {
      const coords = boundary.type === "Polygon" ? boundary.coordinates.flat() : boundary.coordinates.flat(2);
      if (coords.length > 0) {
        let xmin = Number.POSITIVE_INFINITY;
        let ymin = Number.POSITIVE_INFINITY;
        let xmax = Number.NEGATIVE_INFINITY;
        let ymax = Number.NEGATIVE_INFINITY;

        for (const [lon, lat] of coords) {
          xmin = Math.min(xmin, lon);
          ymin = Math.min(ymin, lat);
          xmax = Math.max(xmax, lon);
          ymax = Math.max(ymax, lat);
        }
        // Add a buffer (0.05 degrees) so the user can pan slightly outside
        maxBounds = [
          [xmin - 0.05, ymin - 0.05],
          [xmax + 0.05, ymax + 0.05]
        ];
      }
    }

    // Base road filter - roads in our class list
    const baseRoadFilter: maplibregl.FilterSpecification = ["all",
      ["==", ["get", "subtype"], "road"],
      ["in", ["get", "class"], ["literal", ROAD_CLASS_FILTER]]
    ];

    // Filter for roads that have routes OR have route-like names
    // This helps show connected road networks at lower zoom levels
    const hasRouteFilter: maplibregl.FilterSpecification = ["any",
      // Has routes array (from Overture)
      ["all",
        ["has", "routes"],
        ["!=", ["get", "routes"], "[]"],
        ["!=", ["get", "routes"], null]
      ],
      // OR primary name contains route indicators
      ["any",
        ["in", "Route", ["coalesce", ["get", "primary"], ""]],
        ["in", "Highway", ["coalesce", ["get", "primary"], ""]],
        ["in", "US-", ["coalesce", ["get", "primary"], ""]],
        ["in", "SR-", ["coalesce", ["get", "primary"], ""]],
        ["in", "State Route", ["coalesce", ["get", "primary"], ""]]
      ]
    ];

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      maxBounds,
      style: {
        version: 8,
        name: "Nightfall Hex Dystopian",
        sources: {
          overture_base: {
            type: "vector",
            url: `pmtiles://${pmtilesBase}/base.pmtiles`,
            attribution: "Overture Maps"
          },
          overture_transportation: {
            type: "vector",
            url: `pmtiles://${pmtilesBase}/transportation.pmtiles`,
            attribution: "Overture Maps"
          },
          overture_buildings: {
            type: "vector",
            url: `pmtiles://${pmtilesBase}/buildings.pmtiles`,
            attribution: "Overture Maps"
          }
        },
        layers: [
          // === BASE LAYERS ===
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
      // Hub building glow layer
      {
        id: "buildings-hub-glow",
        source: "overture_buildings",
        "source-layer": "building",
        type: "fill",
        filter: ["==", ["get", "id"], "none"],
        paint: {
          "fill-color": "#ffffff",
          "fill-opacity": 0.15
        }
      },
      // Hub building highlight layer
      {
        id: "buildings-hub",
        source: "overture_buildings",
        "source-layer": "building",
        type: "line",
        filter: ["==", ["get", "id"], "none"],
        paint: {
          "line-color": "#ffffff",
          "line-width": 2,
          "line-opacity": 0.8
        }
      },

          // === ROAD LAYERS ===
          // Route roads - shown at lower zoom for connectivity
          {
            id: "roads-routes",
            source: "overture_transportation",
            "source-layer": "segment",
            type: "line",
            minzoom: 8,
            maxzoom: 13,
            filter: ["all",
              ["==", ["get", "subtype"], "road"],
              hasRouteFilter
            ],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": COLORS.roadsRoute,
              "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 13, 2]
            }
          },
          // Regular road hierarchy
          {
            id: "roads-low",
            source: "overture_transportation",
            "source-layer": "segment",
            type: "line",
            minzoom: 13,
            filter: ["all", baseRoadFilter, ["in", ["get", "class"], ["literal", ["residential", "service"]]]],
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
              ["all", baseRoadFilter, ["in", ["get", "class"], ["literal", ["primary", "secondary", "tertiary"]]]],
              // Also show any road with routes at mid-zoom
              ["all",
                ["==", ["get", "subtype"], "road"],
                hasRouteFilter
              ]
            ],
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
            filter: ["all", baseRoadFilter, ["in", ["get", "class"], ["literal", ["motorway", "trunk"]]]],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": COLORS.roadsHigh,
              "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.5, 10, 1.5, 16, 3]
            }
          },

          // === GAME STATE GLOW LAYERS ===
          {
            id: "game-roads-healthy-glow",
            source: "overture_transportation",
            "source-layer": "segment",
            type: "line",
            filter: ["all", baseRoadFilter, ["==", ["get", "id"], "none"]],
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
            filter: ["all", baseRoadFilter, ["==", ["get", "id"], "none"]],
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
            filter: ["all", baseRoadFilter, ["==", ["get", "id"], "none"]],
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
            filter: ["all", baseRoadFilter, ["==", ["get", "id"], "none"]],
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
            filter: ["all", baseRoadFilter, ["==", ["get", "id"], "none"]],
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
            filter: ["all", baseRoadFilter, ["==", ["get", "id"], "none"]],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": COLORS.degraded,
              "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2, 16, 6],
              "line-opacity": 0.9
            }
          },

          // === REPAIR PULSE LAYER ===
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
          // === COMPLETION FLASH LAYER ===
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
          },
          // === INTERACTION LAYERS ===
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
        ]
      },
      center: [centerLon, centerLat],
      zoom: 14,
      pitch: 45
    });

    map.current.on("load", () => {
      // Add source for the boundary mask (The Fog)
      if (boundary) {
        map.current?.addSource("game-boundary-mask", {
          type: "geojson",
          data: {
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [
                // Outer ring: World
                [[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]],
                // Inner ring: Hole (the boundary)
                ...(boundary.type === "Polygon" 
                  ? boundary.coordinates 
                  : boundary.coordinates.flat(1)) as number[][][]
              ]
            },
            properties: {}
          }
        });

        map.current?.addLayer({
          id: "game-boundary-mask-layer",
          type: "fill",
          source: "game-boundary-mask",
          paint: {
            "fill-color": COLORS.background,
            "fill-opacity": 0.45
          }
        });
      }

      // Add source for hex cells
      map.current?.addSource("game-hexes", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: []
        }
      });

      // Add hex fill layer with reduced opacity so fog doesn't overwhelm
      map.current?.addLayer({
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
          "fill-opacity": [
            "interpolate",
            ["linear"],
            ["get", "rust_level"],
            0, 0.08,
            0.5, 0.16,
            1, 0.26
          ],
          "fill-opacity-transition": { duration: 1500, delay: 0 }
        }
      }, "game-roads-healthy-glow");

      // Add hex outline layer with improved visibility
      map.current?.addLayer({
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
          "line-opacity": [
            "interpolate",
            ["linear"],
            ["get", "rust_level"],
            0, 0.18,
            0.5, 0.32,
            1, 0.5
          ],
          "line-opacity-transition": { duration: 1500, delay: 0 }
        }
      }, "game-roads-healthy-glow");

      // Add crews layer
      map.current?.addSource("game-crews", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });
      
      map.current?.addLayer({
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
      });

      // Add crew glow layer for working crews
      map.current?.addLayer({
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
      }, "game-crews-point");

      // Add resource packages source and layers
      map.current?.addSource("game-resource-packages", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });

      // Trail/path layer
      map.current?.addLayer({
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
      });

      // Package glow layer
      map.current?.addLayer({
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
      });

      // Package point layer
      map.current?.addLayer({
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
      });

      setIsLoaded(true);
    });

    // Click handler
    map.current.on("click", (e) => {
      const clickedFeatures = map.current?.queryRenderedFeatures(e.point, {
        layers: [
          "game-roads-healthy", "game-roads-warning", "game-roads-degraded",
          "roads-low", "roads-mid", "roads-high", "roads-routes", "buildings"
        ]
      });

      if (clickedFeatures && clickedFeatures.length > 0) {
        const feature = clickedFeatures[0];
        const gersId = feature.properties?.id;
        const type = feature.layer.id.includes("buildings") ? "building" : "road";

        // Update both selection layers
        map.current?.setFilter("game-feature-selection", ["==", ["get", "id"], gersId]);
        map.current?.setFilter("game-feature-selection-glow", ["==", ["get", "id"], gersId]);

        window.dispatchEvent(new CustomEvent("nightfall:feature_selected", {
          detail: { gers_id: gersId, type }
        }));
      } else {
        map.current?.setFilter("game-feature-selection", ["==", ["get", "id"], "none"]);
        map.current?.setFilter("game-feature-selection-glow", ["==", ["get", "id"], "none"]);
        window.dispatchEvent(new CustomEvent("nightfall:feature_selected", {
          detail: null
        }));
      }
    });

    // Hover handlers for all interactive road layers
    const interactiveLayers = [
      "game-roads-healthy", "game-roads-warning", "game-roads-degraded",
      "roads-low", "roads-mid", "roads-high", "roads-routes"
    ];

    interactiveLayers.forEach(layer => {
      map.current?.on("mousemove", layer, (e) => {
        if (!map.current) return;
        const id = e.features?.[0]?.properties?.id;
        if (id) {
          map.current.setFilter("game-feature-hover", ["==", ["get", "id"], id]);
          map.current.getCanvas().style.cursor = "pointer";
        }
      });

      map.current?.on("mouseleave", layer, () => {
        if (!map.current) return;
        map.current.setFilter("game-feature-hover", ["==", ["get", "id"], ""]);
        map.current.getCanvas().style.cursor = "";
      });
    });

    return () => {
      map.current?.remove();
      maplibregl.removeProtocol("pmtiles");
    };
  }, [fallbackBbox, boundary, pmtilesBase]);

  // Sync health data to vector tile features
  useEffect(() => {
    if (!isLoaded || !map.current) return;

    const healthyIds = features.filter(f => f.feature_type === "road" && (f.health ?? 100) > 80).map(f => f.gers_id);
    const warningIds = features.filter(f => f.feature_type === "road" && (f.health ?? 100) <= 80 && (f.health ?? 100) > 30).map(f => f.gers_id);
    const degradedIds = features.filter(f => f.feature_type === "road" && (f.health ?? 100) <= 30).map(f => f.gers_id);
    const laborIds = features.filter(f => f.feature_type === "building" && f.generates_labor).map(f => f.gers_id);
    const materialIds = features.filter(f => f.feature_type === "building" && f.generates_materials).map(f => f.gers_id);

    const baseFilter = ["all",
      ["==", ["get", "subtype"], "road"],
      ["in", ["get", "class"], ["literal", ROAD_CLASS_FILTER]]
    ] as maplibregl.FilterSpecification;

    const makeIdFilter = (ids: string[]) =>
      ["in", ["get", "id"], ["literal", ids.length ? ids : ["__none__"]]] as maplibregl.ExpressionSpecification;

    // Update both main and glow layers for each health state
    map.current.setFilter("game-roads-healthy", ["all", baseFilter, makeIdFilter(healthyIds)] as maplibregl.FilterSpecification);
    map.current.setFilter("game-roads-healthy-glow", ["all", baseFilter, makeIdFilter(healthyIds)] as maplibregl.FilterSpecification);

    map.current.setFilter("game-roads-warning", ["all", baseFilter, makeIdFilter(warningIds)] as maplibregl.FilterSpecification);
    map.current.setFilter("game-roads-warning-glow", ["all", baseFilter, makeIdFilter(warningIds)] as maplibregl.FilterSpecification);

    map.current.setFilter("game-roads-degraded", ["all", baseFilter, makeIdFilter(degradedIds)] as maplibregl.FilterSpecification);
    map.current.setFilter("game-roads-degraded-glow", ["all", baseFilter, makeIdFilter(degradedIds)] as maplibregl.FilterSpecification);

    map.current.setFilter("buildings-labor", makeIdFilter(laborIds) as maplibregl.FilterSpecification);
    map.current.setFilter("buildings-materials", makeIdFilter(materialIds) as maplibregl.FilterSpecification);

    // Hub buildings
    const hubIds = features.filter(f => f.feature_type === "building" && f.is_hub).map(f => f.gers_id);
    map.current.setFilter("buildings-hub", makeIdFilter(hubIds) as maplibregl.FilterSpecification);
    map.current.setFilter("buildings-hub-glow", makeIdFilter(hubIds) as maplibregl.FilterSpecification);

  }, [features, isLoaded]);

  // Sync hex data to GeoJSON source
  useEffect(() => {
    if (!isLoaded || !map.current) return;

    const source = map.current.getSource("game-hexes") as maplibregl.GeoJSONSource;
    if (source) {
      source.setData({
        type: "FeatureCollection",
        features: hexes.map(h => {
          try {
            const boundary = cellToBoundary(h.h3_index);
            const coordinates = [boundary.map(([lat, lon]) => [lon, lat])];
            coordinates[0].push(coordinates[0][0]);

            return {
              type: "Feature",
              geometry: {
                type: "Polygon",
                coordinates
              },
              properties: {
                h3_index: h.h3_index,
                rust_level: h.rust_level
              }
            };
          } catch (e) {
            console.error("Failed to calculate boundary for hex", h.h3_index, e);
            return null;
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }).filter((f) => f !== null) as any
      });
    }
  }, [hexes, isLoaded]);

  // Sync crews data
  useEffect(() => {
    if (!isLoaded || !map.current) return;

    const crewFeatures = crews.map(crew => {
        if (!crew.active_task_id) return null;
        const task = tasks.find(t => t.task_id === crew.active_task_id);
        if (!task) return null;
        const feature = features.find(f => f.gers_id === task.target_gers_id);
        if (!feature) return null;
        
        let coords: [number, number] | null = null;
        if (feature.bbox) {
            coords = [(feature.bbox[0] + feature.bbox[2])/2, (feature.bbox[1] + feature.bbox[3])/2];
        } else if (feature.geometry) {
             const g = feature.geometry;
             if (g.type === 'Point') coords = g.coordinates as [number, number];
             else if (g.type === 'LineString') coords = (g.coordinates as number[][])[0] as [number, number];
             else if (g.type === 'Polygon') coords = (g.coordinates as number[][][])[0][0] as [number, number];
        }

        if (!coords) return null;

        return {
            type: "Feature",
            geometry: { type: "Point", coordinates: coords },
            properties: { ...crew }
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }).filter((f) => f !== null) as any;

    const source = map.current.getSource("game-crews") as maplibregl.GeoJSONSource;
    if (source) {
        source.setData({
            type: "FeatureCollection",
            features: crewFeatures
        });
    }
  }, [crews, tasks, features, isLoaded]);

  // Listen for task completion events and animate
  useEffect(() => {
    const handleTaskCompleted = (e: Event) => {
      const customEvent = e as CustomEvent<{ gers_id: string }>;
      const gersId = customEvent.detail.gers_id;

      if (!map.current || !isLoaded) return;

      // Flash the completion layer
      const baseFilter: maplibregl.FilterSpecification = ["all",
        ["==", ["get", "subtype"], "road"],
        ["==", ["get", "id"], gersId]
      ];

      map.current.setFilter("game-roads-completion-flash", baseFilter);
      map.current.setPaintProperty("game-roads-completion-flash", "line-opacity", 0.9);

      // Animate fade out
      let opacity = 0.9;
      const fadeInterval = setInterval(() => {
        opacity -= 0.05;
        if (opacity <= 0 || !map.current) {
          clearInterval(fadeInterval);
          map.current?.setFilter("game-roads-completion-flash", ["==", ["get", "id"], "none"]);
        } else {
          map.current?.setPaintProperty("game-roads-completion-flash", "line-opacity", opacity);
        }
      }, 50);
    };

    window.addEventListener("nightfall:task_completed", handleTaskCompleted);
    return () => window.removeEventListener("nightfall:task_completed", handleTaskCompleted);
  }, [isLoaded]);

  // Animate repair pulse for roads being repaired
  useEffect(() => {
    if (!isLoaded || !map.current) return;

    const baseFilter: maplibregl.FilterSpecification = ["all",
      ["==", ["get", "subtype"], "road"],
      ["in", ["get", "id"], ["literal", repairingRoadIds.length ? repairingRoadIds : ["__none__"]]]
    ];

    map.current.setFilter("game-roads-repair-pulse", baseFilter);

    // Start pulse animation
    if (repairingRoadIds.length > 0) {
      let pulsePhase = 0;
      const pulseAnimation = () => {
        if (!map.current) return;
        pulsePhase = (pulsePhase + 0.05) % (2 * Math.PI);
        const opacity = 0.2 + 0.25 * Math.sin(pulsePhase);
        const width = 12 + 6 * Math.sin(pulsePhase);
        map.current.setPaintProperty("game-roads-repair-pulse", "line-opacity", opacity);
        map.current.setPaintProperty("game-roads-repair-pulse", "line-width",
          ["interpolate", ["linear"], ["zoom"], 12, width, 16, width * 2]
        );
        repairPulseRef.current = requestAnimationFrame(pulseAnimation);
      };
      repairPulseRef.current = requestAnimationFrame(pulseAnimation);
    } else {
      if (repairPulseRef.current) {
        cancelAnimationFrame(repairPulseRef.current);
        repairPulseRef.current = null;
      }
    }

    return () => {
      if (repairPulseRef.current) {
        cancelAnimationFrame(repairPulseRef.current);
      }
    };
  }, [repairingRoadIds, isLoaded]);

  // Helper to get building center
  const getBuildingCenter = useCallback((building: Feature): [number, number] | null => {
    if (building.bbox) {
      return [
        (building.bbox[0] + building.bbox[2]) / 2,
        (building.bbox[1] + building.bbox[3]) / 2
      ];
    } else if (building.geometry) {
      const g = building.geometry;
      if (g.type === "Point") return g.coordinates as [number, number];
      else if (g.type === "Polygon") {
        const ring = (g.coordinates as number[][][])[0];
        const sumLng = ring.reduce((s, c) => s + c[0], 0);
        const sumLat = ring.reduce((s, c) => s + c[1], 0);
        return [sumLng / ring.length, sumLat / ring.length];
      }
    }
    return null;
  }, []);

  // Function to spawn a resource package animation
  const spawnResourcePackage = useCallback((
    buildingGersId: string,
    resourceType: "labor" | "materials"
  ) => {
    if (!isLoaded) return;

    // Find the source building
    const building = features.find(f => f.gers_id === buildingGersId && f.feature_type === "building");
    if (!building) return;

    // Get building center
    const buildingCenter = getBuildingCenter(building);
    if (!buildingCenter) return;

    // Find the hub building for this hex
    // First, get the hex for this building's location
    const h3Index = latLngToCell(buildingCenter[1], buildingCenter[0], 8);

    // Find a hub building in the same hex (or nearby)
    const hubBuilding = features.find(f =>
      f.feature_type === "building" &&
      f.is_hub &&
      f.gers_id !== buildingGersId
    );

    // Determine target: hub building center if found, otherwise hex centroid
    let targetCenter: [number, number];
    if (hubBuilding) {
      const hubCenter = getBuildingCenter(hubBuilding);
      if (hubCenter) {
        targetCenter = hubCenter;
      } else {
        // Fallback to hex centroid
        const hexBoundary = cellToBoundary(h3Index);
        targetCenter = [
          hexBoundary.reduce((s, c) => s + c[1], 0) / hexBoundary.length,
          hexBoundary.reduce((s, c) => s + c[0], 0) / hexBoundary.length
        ];
      }
    } else {
      // No hub found, use hex centroid
      const hexBoundary = cellToBoundary(h3Index);
      targetCenter = [
        hexBoundary.reduce((s, c) => s + c[1], 0) / hexBoundary.length,
        hexBoundary.reduce((s, c) => s + c[0], 0) / hexBoundary.length
      ];
    }

    // Get road features for pathfinding
    const roads = features
      .filter(f => f.feature_type === "road" && f.geometry?.type === "LineString")
      .map(f => ({ geometry: { coordinates: f.geometry!.coordinates as number[][] } }));

    // Build path
    const path = buildResourcePath(buildingCenter, targetCenter, roads);

    // Create package
    const newPackage: ResourcePackage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: resourceType,
      path,
      progress: 0,
      startTime: Date.now(),
      duration: 2500 // 2.5 seconds
    };

    setResourcePackages(prev => [...prev, newPackage]);
  }, [features, isLoaded, getBuildingCenter]);

  // Listen for contribution events
  useEffect(() => {
    const handleContribution = (e: Event) => {
      const customEvent = e as CustomEvent<{
        buildingGersId: string;
        resourceType: "labor" | "materials";
      }>;
      spawnResourcePackage(
        customEvent.detail.buildingGersId,
        customEvent.detail.resourceType
      );
    };

    window.addEventListener("nightfall:resource_contributed", handleContribution);
    return () => window.removeEventListener("nightfall:resource_contributed", handleContribution);
  }, [spawnResourcePackage]);

  // Animate resource packages
  useEffect(() => {
    if (!isLoaded || !map.current || resourcePackages.length === 0) {
      // Clean up source if no packages
      if (isLoaded && map.current) {
        const source = map.current.getSource("game-resource-packages") as maplibregl.GeoJSONSource;
        if (source) {
          source.setData({ type: "FeatureCollection", features: [] });
        }
      }
      return;
    }

    const animate = () => {
      const now = Date.now();
      const activePackages: ResourcePackage[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const geoFeatures: any[] = [];

      for (const pkg of resourcePackages) {
        const elapsed = now - pkg.startTime;
        const rawProgress = Math.min(1, elapsed / pkg.duration);

        if (rawProgress < 1) {
          // Update progress with easing
          const easedProgress = easeInOutCubic(rawProgress);
          const position = interpolatePath(pkg.path, easedProgress);

          // Calculate opacity (fade in/out at edges)
          let opacity = 1;
          if (rawProgress < 0.1) opacity = rawProgress / 0.1;
          else if (rawProgress > 0.9) opacity = (1 - rawProgress) / 0.1;

          // Add trail (completed portion of path)
          const trailCoords = [];
          for (let t = 0; t <= easedProgress; t += 0.02) {
            trailCoords.push(interpolatePath(pkg.path, t));
          }
          if (trailCoords.length > 1) {
            geoFeatures.push({
              type: "Feature",
              geometry: { type: "LineString", coordinates: trailCoords },
              properties: { featureType: "trail", resourceType: pkg.type }
            });
          }

          // Add package point
          geoFeatures.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: position },
            properties: {
              featureType: "package",
              resourceType: pkg.type,
              opacity
            }
          });

          activePackages.push({ ...pkg, progress: easedProgress });
        }
        // Package completed - don't add to active list
      }

      // Update source
      const source = map.current?.getSource("game-resource-packages") as maplibregl.GeoJSONSource;
      if (source) {
        source.setData({ type: "FeatureCollection", features: geoFeatures });
      }

      // Update state if packages changed
      if (activePackages.length !== resourcePackages.length) {
        setResourcePackages(activePackages);
      }

      // Continue animation if there are active packages
      if (activePackages.length > 0) {
        resourceAnimationRef.current = requestAnimationFrame(animate);
      }
    };

    resourceAnimationRef.current = requestAnimationFrame(animate);

    return () => {
      if (resourceAnimationRef.current) {
        cancelAnimationFrame(resourceAnimationRef.current);
      }
    };
  }, [resourcePackages, isLoaded]);

  return (
    <div className="relative overflow-hidden rounded-3xl border border-[var(--night-outline)] bg-[#101216] shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
      <div className="absolute top-0 z-10 flex w-full items-center justify-between border-b border-white/5 bg-[#101216]/80 px-6 py-4 text-sm uppercase tracking-[0.3em] text-[color:var(--night-ash)] backdrop-blur-md">
        <span>Bar Harbor Tactical Map</span>
        <span className="rounded-full border border-white/10 px-3 py-1 text-[0.65rem] tracking-[0.35em] text-[color:var(--night-teal)]">
          Live Vector Stream
        </span>
      </div>
      <div
        ref={mapContainer}
        className="h-[640px] w-full transition-all duration-[2000ms] ease-in-out"
        style={{ filter: PHASE_FILTERS[cycle.phase] }}
      />
    </div>
  );
}
