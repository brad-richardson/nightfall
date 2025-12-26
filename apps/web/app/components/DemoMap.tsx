"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import * as pmtiles from "pmtiles";
import { cellToBoundary } from "h3-js";
import { ROAD_CLASS_FILTER } from "@nightfall/config";
import { MapTooltip, type TooltipData } from "./MapTooltip";
import type { Phase } from "../store";
import {
  type ResourcePackage,
  buildResourcePath,
  interpolatePath,
  easeInOutCubic
} from "../lib/resourceAnimation";
import { AnimationManager } from "../lib/animationManager";

type Feature = {
  gers_id: string;
  feature_type: string;
  h3_index?: string | null;
  bbox: [number, number, number, number] | null;
  geometry?: {
    type: "Point" | "LineString" | "MultiLineString" | "Polygon" | "MultiPolygon";
    coordinates: number[] | number[][] | number[][][] | number[][][][] | number[][][][];
  } | null;
  health?: number | null;
  status?: string | null;
  road_class?: string | null;
  place_category?: string | null;
  generates_labor?: boolean;
  generates_materials?: boolean;
  is_hub?: boolean;
};

type Crew = {
  crew_id: string;
  status: string;
  active_task_id: string | null;
  busy_until?: string | null;
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

type CrewPath = {
  crew_id: string;
  task_id: string;
  path: [number, number][];
  startTime: number;
  endTime: number;
  status: "traveling" | "working";
};

type ResourceTransferPayload = {
  transfer_id: string;
  region_id: string;
  source_gers_id: string | null;
  hub_gers_id: string | null;
  resource_type: "labor" | "materials";
  amount: number;
  depart_at: string;
  arrive_at: string;
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
    phase: Phase;
    phase_progress: number;
    next_phase: Phase;
  };
  pmtilesRelease: string;
  children?: React.ReactNode;
  className?: string;
};

// Crew status colors
const CREW_COLORS = {
  idle: "#888888",
  traveling: "#f0ddc2",
  working: "#3eb0c0",
  returning: "#f08a4e"
};


const PHASE_FILTERS: Record<Phase, string> = {
  dawn: "brightness(1.05) saturate(0.9) contrast(1.1)",
  day: "brightness(1.0) saturate(1.0) contrast(1.0)",
  dusk: "brightness(0.85) saturate(0.8) sepia(0.15) contrast(1.15)",
  night: "brightness(0.7) saturate(0.6) sepia(0.3) contrast(1.25)"
};

const RUST_FILL_OPACITY_BASE: maplibregl.ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["get", "rust_level"],
  0, 0.08,
  0.5, 0.16,
  1, 0.26
];

const RUST_LINE_OPACITY_BASE: maplibregl.ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["get", "rust_level"],
  0, 0.18,
  0.5, 0.32,
  1, 0.5
];

const RUST_PHASE_MULTIPLIER: Record<Phase, number> = {
  night: 1.5,
  dusk: 1.2,
  dawn: 0.8,
  day: 0.6
};

const CREW_DASH_SEQUENCE: number[][] = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0]
];

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
  pmtilesRelease,
  children,
  className
}: DemoMapProps) {
  const mapShellRef = useRef<HTMLDivElement>(null);
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [resourcePackages, setResourcePackages] = useState<ResourcePackage[]>([]);
  const [queuedTaskRoadIds, setQueuedTaskRoadIds] = useState<string[]>([]);
  const [tooltipData, setTooltipData] = useState<TooltipData | null>(null);
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [crewPaths, setCrewPaths] = useState<CrewPath[]>([]);

  // Centralized animation manager for all requestAnimationFrame loops
  const animationManager = useMemo(() => new AnimationManager(60), []);

  const breathePhaseRef = useRef(0);
  const hoverTimeoutRef = useRef<number | null>(null);
  const tooltipDismissRef = useRef<number | null>(null);
  const pmtilesBase = useMemo(
    () => `https://d3c1b7bog2u1nn.cloudfront.net/${pmtilesRelease}`,
    [pmtilesRelease]
  );

  const featuresRef = useRef(features);
  const tasksRef = useRef(tasks);

  // Get IDs of roads currently being repaired (in_progress tasks)
  const repairingRoadIds = useMemo(() => {
    const ids = tasks
      .filter(t => t.status === "in_progress")
      .map(t => t.target_gers_id)
      .filter((id): id is string => Boolean(id));
    return Array.from(new Set(ids));
  }, [tasks]);

  const roadFeaturesForPath = useMemo(() => {
    const roads: { geometry: { coordinates: number[][] } }[] = [];
    for (const feature of features) {
      if (feature.feature_type !== "road" || !feature.geometry) continue;
      if (feature.geometry.type === "LineString") {
        roads.push({ geometry: { coordinates: feature.geometry.coordinates as number[][] } });
      } else if (feature.geometry.type === "MultiLineString") {
        const multiCoords = feature.geometry.coordinates as number[][][];
        for (const line of multiCoords) {
          roads.push({ geometry: { coordinates: line } });
        }
      }
    }
    return roads;
  }, [features]);

  const travelingCrewIds = useMemo(() => new Set(crewPaths.map((path) => path.crew_id)), [crewPaths]);

  const getTransitionGradient = useCallback((_currentPhase: Phase, nextPhase: Phase): string => {
    if (nextPhase === "night") {
      return "radial-gradient(circle at 50% 50%, transparent 0%, rgba(10, 10, 30, 0.4) 100%)";
    }
    if (nextPhase === "dawn") {
      return "radial-gradient(circle at 70% 30%, rgba(255, 180, 100, 0.2) 0%, transparent 100%)";
    }
    if (nextPhase === "day") {
      return "linear-gradient(to top, transparent 0%, rgba(135, 206, 235, 0.1) 100%)";
    }
    if (nextPhase === "dusk") {
      return "linear-gradient(to bottom, rgba(255, 100, 50, 0.2) 0%, transparent 100%)";
    }
    return "transparent";
  }, []);

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mobileQuery = window.matchMedia("(max-width: 768px)");

    const update = () => {
      setPrefersReducedMotion(motionQuery.matches);
      setIsMobile(mobileQuery.matches);
    };

    update();

    // Use standard addEventListener (supported by all modern browsers)
    motionQuery.addEventListener("change", update);
    mobileQuery.addEventListener("change", update);
    return () => {
      motionQuery.removeEventListener("change", update);
      mobileQuery.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    const node = mapShellRef.current;
    if (!node) return;

    const updateSize = () => {
      setMapSize({ width: node.clientWidth, height: node.clientHeight });
      map.current?.resize();
    };

    updateSize();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateSize);
      return () => window.removeEventListener("resize", updateSize);
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const ids = tasks
      .filter((t) => t.status === "queued" || t.status === "pending")
      .map((t) => t.target_gers_id)
      .filter((id): id is string => Boolean(id));
    setQueuedTaskRoadIds(Array.from(new Set(ids)));
  }, [tasks]);

  useEffect(() => {
    featuresRef.current = features;
  }, [features]);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    if (!mapContainer.current) return;

    // Prevent re-initialization if map already exists
    if (map.current) return;

    setIsLoaded(false);
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

    const mapInstance = new maplibregl.Map({
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
          "fill-opacity": 0.3
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
          "line-width": 3,
          "line-opacity": 0.95
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

          // === TASK HIGHLIGHT LAYERS ===
          {
            id: "game-roads-task-highlight-glow",
            source: "overture_transportation",
            "source-layer": "segment",
            type: "line",
            filter: ["all", baseRoadFilter, ["==", ["get", "id"], "none"]],
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
            filter: ["all", baseRoadFilter, ["==", ["get", "id"], "none"]],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#ffffff",
              "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2, 16, 4],
              "line-dasharray": [2, 3],
              "line-opacity": 0.6
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
    map.current = mapInstance;

    mapInstance.on("load", () => {
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
          "fill-opacity": RUST_FILL_OPACITY_BASE,
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
          "line-opacity": RUST_LINE_OPACITY_BASE,
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

      map.current?.addSource("game-central-hub", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });

      map.current?.addLayer({
        id: "game-central-hub-glow",
        type: "circle",
        source: "game-central-hub",
        paint: {
          "circle-radius": 22,
          "circle-color": "#f0ddc2",
          "circle-blur": 0.8,
          "circle-opacity": 0.35
        }
      });

      map.current?.addLayer({
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
      });

      // Add crew travel path sources/layers
      map.current?.addSource("game-crew-paths", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });

      map.current?.addLayer({
        id: "game-crew-path-line",
        type: "line",
        source: "game-crew-paths",
        paint: {
          "line-color": "#f0ddc2",
          "line-width": 2,
          "line-dasharray": [2, 2],
          "line-opacity": 0.6
        }
      }, "game-crews-point");

      map.current?.addSource("game-crew-markers", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });

      map.current?.addLayer({
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
      });

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
      map.current?.resize();
    });

    // Click handler
    mapInstance.on("click", (e) => {
      const clickedFeatures = mapInstance.queryRenderedFeatures(e.point, {
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
        mapInstance.setFilter("game-feature-selection", ["==", ["get", "id"], gersId]);
        mapInstance.setFilter("game-feature-selection-glow", ["==", ["get", "id"], gersId]);

        window.dispatchEvent(new CustomEvent("nightfall:feature_selected", {
          detail: { 
            gers_id: gersId, 
            type,
            position: { x: e.point.x, y: e.point.y }
          }
        }));
      } else {
        mapInstance.setFilter("game-feature-selection", ["==", ["get", "id"], "none"]);
        mapInstance.setFilter("game-feature-selection-glow", ["==", ["get", "id"], "none"]);
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
      mapInstance.on("mousemove", layer, (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id) {
          mapInstance.setFilter("game-feature-hover", ["==", ["get", "id"], id]);
          mapInstance.getCanvas().style.cursor = "pointer";
        }
      });

      mapInstance.on("mouseleave", layer, () => {
        mapInstance.setFilter("game-feature-hover", ["==", ["get", "id"], ""]);
        mapInstance.getCanvas().style.cursor = "";
      });
    });

    return () => {
      mapInstance.remove();
      if (map.current === mapInstance) {
        map.current = null;
      }
      maplibregl.removeProtocol("pmtiles");
    };
  }, [fallbackBbox, boundary, pmtilesBase]);

  // Hover/tap tooltips
  useEffect(() => {
    if (!isLoaded || !map.current) return;

    const mapInstance = map.current;
    const tooltipLayers = [
      "game-roads-healthy",
      "game-roads-warning",
      "game-roads-degraded",
      "roads-low",
      "roads-mid",
      "roads-high",
      "roads-routes",
      "buildings",
      "buildings-labor",
      "buildings-materials",
      "buildings-hub",
      "game-hex-fill"
    ];

    const normalizePercent = (value: number | null | undefined) => {
      if (value === null || value === undefined || Number.isNaN(value)) return 0;
      return value <= 1 ? value * 100 : value;
    };

    const buildTooltipData = (
      feature: maplibregl.MapGeoJSONFeature,
      point: maplibregl.Point
    ): TooltipData | null => {
      const layerId = feature.layer.id;
      const gersId = feature.properties?.id as string | undefined;

      if (layerId.includes("hex")) {
        const rust = normalizePercent(Number(feature.properties?.rust_level));
        return {
          type: "hex",
          position: { x: point.x, y: point.y },
          data: { rust_level: rust }
        };
      }

      if (layerId.includes("buildings") || layerId.includes("building")) {
        const match = gersId
          ? featuresRef.current.find((f) => f.gers_id === gersId)
          : null;
        return {
          type: "building",
          position: { x: point.x, y: point.y },
          data: {
            category: match?.place_category ?? feature.properties?.class ?? "Building",
            generates_labor: Boolean(match?.generates_labor),
            generates_materials: Boolean(match?.generates_materials)
          }
        };
      }

      if (gersId) {
        const match = featuresRef.current.find((f) => f.gers_id === gersId);
        const taskMatch = tasksRef.current.find((t) => t.target_gers_id === gersId);
        const status = taskMatch?.status ?? match?.status ?? "";
        return {
          type: "road",
          position: { x: point.x, y: point.y },
          data: {
            road_class: match?.road_class ?? feature.properties?.class ?? "road",
            health: normalizePercent(match?.health ?? 100),
            status
          }
        };
      }

      return null;
    };

    const resolveTooltip = (point: maplibregl.Point) => {
      const featuresAtPoint = mapInstance.queryRenderedFeatures(point, {
        layers: tooltipLayers
      });

      if (!featuresAtPoint.length) {
        setTooltipData(null);
        return;
      }

      // Prioritize specific features over hexes
      const nonHexFeature = featuresAtPoint.find(f => !f.layer.id.includes("hex"));
      const topFeature = nonHexFeature ?? featuresAtPoint[0];
      
      const data = buildTooltipData(topFeature, point);
      setTooltipData(data);
    };

    const scheduleTooltip = (point: maplibregl.Point) => {
      if (hoverTimeoutRef.current) window.clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = window.setTimeout(() => {
        resolveTooltip(point);
      }, 200);
    };

    const clearTooltip = () => {
      if (hoverTimeoutRef.current) window.clearTimeout(hoverTimeoutRef.current);
      if (tooltipDismissRef.current) window.clearTimeout(tooltipDismissRef.current);
      setTooltipData(null);
    };

    const handleMouseMove = (e: maplibregl.MapMouseEvent) => {
      if (isMobile) return;
      scheduleTooltip(e.point);
    };

    const handleMouseLeave = () => {
      clearTooltip();
    };

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      if (!isMobile) return;
      resolveTooltip(e.point);
      if (tooltipDismissRef.current) window.clearTimeout(tooltipDismissRef.current);
      tooltipDismissRef.current = window.setTimeout(() => {
        setTooltipData(null);
      }, 3000);
    };

    mapInstance.on("mousemove", handleMouseMove);
    mapInstance.on("click", handleClick);
    mapInstance.getCanvas().addEventListener("mouseleave", handleMouseLeave);

    return () => {
      mapInstance.off("mousemove", handleMouseMove);
      mapInstance.off("click", handleClick);
      mapInstance.getCanvas().removeEventListener("mouseleave", handleMouseLeave);
      clearTooltip();
    };
  }, [isLoaded, isMobile]);

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

  const fallbackCenter = useMemo<[number, number]>(() => {
    return [
      (fallbackBbox.xmin + fallbackBbox.xmax) / 2,
      (fallbackBbox.ymin + fallbackBbox.ymax) / 2
    ];
  }, [fallbackBbox]);

  const getFeatureCenter = useCallback((feature: Feature): [number, number] | null => {
    if (feature.bbox) {
      return [
        (feature.bbox[0] + feature.bbox[2]) / 2,
        (feature.bbox[1] + feature.bbox[3]) / 2
      ];
    }

    if (!feature.geometry) return null;

    const g = feature.geometry;
    if (g.type === "Point") return g.coordinates as [number, number];
    if (g.type === "LineString") {
      const coords = g.coordinates as number[][];
      if (coords.length === 0) return null;
      const mid = coords[Math.floor(coords.length / 2)];
      return [mid[0], mid[1]];
    }
    if (g.type === "MultiLineString") {
      const lines = g.coordinates as number[][][];
      const firstLine = lines[0];
      if (!firstLine || firstLine.length === 0) return null;
      const mid = firstLine[Math.floor(firstLine.length / 2)];
      return [mid[0], mid[1]];
    }
    if (g.type === "Polygon") {
      const ring = (g.coordinates as number[][][])[0];
      if (!ring?.length) return null;
      const sumLng = ring.reduce((s, c) => s + c[0], 0);
      const sumLat = ring.reduce((s, c) => s + c[1], 0);
      return [sumLng / ring.length, sumLat / ring.length];
    }
    if (g.type === "MultiPolygon") {
      const ring = (g.coordinates as number[][][][])[0]?.[0];
      if (!ring?.length) return null;
      const sumLng = ring.reduce((s, c) => s + c[0], 0);
      const sumLat = ring.reduce((s, c) => s + c[1], 0);
      return [sumLng / ring.length, sumLat / ring.length];
    }
    return null;
  }, []);

  const getNearestHubCenter = useCallback((target?: [number, number] | null): [number, number] | null => {
    const hubs = features.filter((f) => f.feature_type === "building" && f.is_hub);
    if (hubs.length === 0) return null;

    let bestCenter: [number, number] | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const hub of hubs) {
      const center = getFeatureCenter(hub);
      if (!center) continue;
      if (!target) return center;
      const dx = center[0] - target[0];
      const dy = center[1] - target[1];
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestCenter = center;
      }
    }

    return bestCenter;
  }, [features, getFeatureCenter]);

  // Sync central hub marker
  useEffect(() => {
    if (!isLoaded || !map.current) return;

    const hubFeatures = features.filter((f) => f.feature_type === "building" && f.is_hub);
    const hubSource = map.current.getSource("game-central-hub") as maplibregl.GeoJSONSource | undefined;
    if (!hubSource) return;

    if (hubFeatures.length === 0) {
      hubSource.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    let bestCenter: [number, number] | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const hub of hubFeatures) {
      const center = getFeatureCenter(hub);
      if (!center) continue;
      const dx = center[0] - fallbackCenter[0];
      const dy = center[1] - fallbackCenter[1];
      const dist = dx * dx + dy * dy;
      if (dist < bestDistance) {
        bestDistance = dist;
        bestCenter = center;
      }
    }

    if (!bestCenter) {
      hubSource.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    hubSource.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: bestCenter }
        }
      ]
    });
  }, [features, fallbackCenter, getFeatureCenter, isLoaded]);

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

  // Build crew travel paths for traveling crews
  useEffect(() => {
    if (!crews.length) {
      setCrewPaths([]);
      return;
    }

    const now = Date.now();
    const paths: CrewPath[] = [];

    for (const crew of crews) {
      if (crew.status !== "traveling" || !crew.active_task_id) continue;
      const task = tasks.find((t) => t.task_id === crew.active_task_id);
      if (!task?.target_gers_id) continue;

      const targetFeature = features.find((f) => f.gers_id === task.target_gers_id);
      const destination = targetFeature ? getFeatureCenter(targetFeature) : null;
      if (!destination) continue;

      const hubCenter = getNearestHubCenter(destination) ?? fallbackCenter;
      const path = buildResourcePath(hubCenter, destination, roadFeaturesForPath);

      const busyUntil = crew.busy_until ? new Date(crew.busy_until).getTime() : null;
      const endTime = busyUntil && !Number.isNaN(busyUntil) ? busyUntil : now + 10000;
      const startTime = Math.min(now, endTime - 1000);

      paths.push({
        crew_id: crew.crew_id,
        task_id: task.task_id,
        path: path.map((p) => [p[0], p[1]]),
        startTime,
        endTime,
        status: "traveling"
      });
    }

    setCrewPaths(paths);
  }, [crews, tasks, features, roadFeaturesForPath, getFeatureCenter, getNearestHubCenter, fallbackCenter]);

  // Sync crews data
  useEffect(() => {
    if (!isLoaded || !map.current) return;

    const crewFeatures = crews.map(crew => {
        if (travelingCrewIds.has(crew.crew_id)) return null;
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
  }, [crews, tasks, features, isLoaded, travelingCrewIds]);

  // Sync crew path data to GeoJSON source
  useEffect(() => {
    if (!isLoaded || !map.current) return;

    const pathSource = map.current.getSource("game-crew-paths") as maplibregl.GeoJSONSource;
    if (pathSource) {
      pathSource.setData({
        type: "FeatureCollection",
        features: crewPaths.map((cp) => ({
          type: "Feature",
          properties: { crew_id: cp.crew_id },
          geometry: { type: "LineString", coordinates: cp.path }
        }))
      });
    }

    if (crewPaths.length === 0) {
      const markerSource = map.current.getSource("game-crew-markers") as maplibregl.GeoJSONSource;
      markerSource?.setData({ type: "FeatureCollection", features: [] });
    }
  }, [crewPaths, isLoaded]);

  // Animate crew paths and markers
  useEffect(() => {
    if (!isLoaded || !map.current) return;

    // Stop any existing crew animation
    animationManager.stop('crew-paths');

    if (crewPaths.length === 0) return;

    const mapInstance = map.current;
    const markerSource = mapInstance.getSource("game-crew-markers") as maplibregl.GeoJSONSource | undefined;
    if (!markerSource) return;

    const updateMarkers = (now: number) => {
      const markerFeatures = crewPaths.map((cp) => {
        const duration = Math.max(1, cp.endTime - cp.startTime);
        const progress = (now - cp.startTime) / duration;
        const clampedProgress = Math.max(0, Math.min(1, progress));
        const position = interpolatePath(cp.path, clampedProgress);

        return {
          type: "Feature" as const,
          properties: { crew_id: cp.crew_id },
          geometry: {
            type: "Point" as const,
            coordinates: position
          }
        };
      });

      markerSource.setData({
        type: "FeatureCollection",
        features: markerFeatures
      });
    };

    if (prefersReducedMotion) {
      updateMarkers(Date.now());
      return;
    }

    let dashIndex = 0;
    let lastDashTime = 0;

    animationManager.start('crew-paths', (time: number) => {
      if (!mapInstance) return;

      if (time - lastDashTime > 120) {
        dashIndex = (dashIndex + 1) % CREW_DASH_SEQUENCE.length;
        mapInstance.setPaintProperty("game-crew-path-line", "line-dasharray", CREW_DASH_SEQUENCE[dashIndex]);
        lastDashTime = time;
      }

      updateMarkers(Date.now());
    });

    return () => animationManager.stop('crew-paths');
  }, [crewPaths, isLoaded, prefersReducedMotion, animationManager]);

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

  // Highlight queued/pending task roads
  useEffect(() => {
    if (!isLoaded || !map.current) return;

    const taskFilter: maplibregl.FilterSpecification = ["all",
      ["==", ["get", "subtype"], "road"],
      ["in", ["get", "id"], ["literal", queuedTaskRoadIds.length ? queuedTaskRoadIds : ["__none__"]]]
    ];

    map.current.setFilter("game-roads-task-highlight-glow", taskFilter);
    map.current.setFilter("game-roads-task-highlight-dash", taskFilter);
  }, [queuedTaskRoadIds, isLoaded]);

  // Animate repair pulse for roads being repaired
  useEffect(() => {
    if (!isLoaded || !map.current) return;

    const baseFilter: maplibregl.FilterSpecification = ["all",
      ["==", ["get", "subtype"], "road"],
      ["in", ["get", "id"], ["literal", repairingRoadIds.length ? repairingRoadIds : ["__none__"]]]
    ];

    map.current.setFilter("game-roads-repair-pulse", baseFilter);

    // Start pulse animation
    animationManager.stop('repair-pulse');

    if (repairingRoadIds.length > 0) {
      let pulsePhase = 0;
      animationManager.start('repair-pulse', () => {
        if (!map.current) return;
        pulsePhase = (pulsePhase + 0.05) % (2 * Math.PI);
        const opacity = 0.2 + 0.25 * Math.sin(pulsePhase);
        const width = 12 + 6 * Math.sin(pulsePhase);
        map.current.setPaintProperty("game-roads-repair-pulse", "line-opacity", opacity);
        map.current.setPaintProperty("game-roads-repair-pulse", "line-width",
          ["interpolate", ["linear"], ["zoom"], 12, width, 16, width * 2]
        );
      });
    }

    return () => animationManager.stop('repair-pulse');
  }, [repairingRoadIds, isLoaded, animationManager]);

  // Prepare rust opacity transitions
  useEffect(() => {
    if (!isLoaded || !map.current) return;

    map.current.setPaintProperty("game-hex-fill", "fill-opacity-transition", {
      duration: 1000,
      delay: 0
    });
    map.current.setPaintProperty("game-hex-outline", "line-opacity-transition", {
      duration: 1000,
      delay: 0
    });
  }, [isLoaded]);

  // Animate rust "breathing" during night/dusk phases
  useEffect(() => {
    if (!isLoaded || !map.current) return;

    const mapInstance = map.current;
    const phaseMultiplier = RUST_PHASE_MULTIPLIER[cycle.phase];

    const applyStaticOpacity = (multiplier: number) => {
      mapInstance.setPaintProperty(
        "game-hex-fill",
        "fill-opacity",
        ["*", RUST_FILL_OPACITY_BASE, multiplier] as maplibregl.ExpressionSpecification
      );
      mapInstance.setPaintProperty(
        "game-hex-outline",
        "line-opacity",
        ["*", RUST_LINE_OPACITY_BASE, multiplier] as maplibregl.ExpressionSpecification
      );
    };

    // Stop any existing rust animation
    animationManager.stop('rust-breathing');

    if (prefersReducedMotion || (cycle.phase !== "night" && cycle.phase !== "dusk")) {
      applyStaticOpacity(phaseMultiplier);
      return;
    }

    animationManager.start('rust-breathing', () => {
      breathePhaseRef.current += 0.015;
      const pulse = 1 + 0.1 * Math.sin(breathePhaseRef.current);
      const multiplier = pulse * phaseMultiplier;
      applyStaticOpacity(multiplier);
    });

    return () => animationManager.stop('rust-breathing');
  }, [cycle.phase, isLoaded, prefersReducedMotion, animationManager]);

  const spawnResourceTransfer = useCallback((transfer: ResourceTransferPayload) => {
    if (!isLoaded) return;

    console.debug("[spawnResourceTransfer] Received transfer", transfer);

    const departAt = Date.parse(transfer.depart_at);
    const arriveAt = Date.parse(transfer.arrive_at);
    const startTime = Number.isNaN(departAt) ? Date.now() : departAt;
    // Add 10s buffer to endTime to handle potential client/server clock desync
    const endTime = (Number.isNaN(arriveAt) ? startTime + 4000 : arriveAt) + 10000;

    if (Date.now() >= endTime) {
      console.debug("[spawnResourceTransfer] Skipping transfer: already arrived", { now: Date.now(), endTime });
      return;
    }

    const sourceFeature = transfer.source_gers_id
      ? features.find((f) => f.gers_id === transfer.source_gers_id)
      : null;
    const hubFeature = transfer.hub_gers_id
      ? features.find((f) => f.gers_id === transfer.hub_gers_id)
      : null;

    const sourceCenter = sourceFeature ? getFeatureCenter(sourceFeature) : fallbackCenter;
    const hubCenter = hubFeature
      ? getFeatureCenter(hubFeature)
      : getNearestHubCenter(sourceCenter) ?? fallbackCenter;

    if (!sourceCenter || !hubCenter) {
      console.warn("[spawnResourceTransfer] Transfer missing source or hub center", { sourceCenter, hubCenter, transfer });
      return;
    }

    console.debug("[spawnResourceTransfer] Building path", { sourceCenter, hubCenter, roadCount: roadFeaturesForPath.length });
    const path = buildResourcePath(sourceCenter, hubCenter, roadFeaturesForPath);
    const duration = Math.max(1000, endTime - startTime);

    setResourcePackages((prev) => {
      if (prev.some((pkg) => pkg.id === transfer.transfer_id)) {
        return prev;
      }
      console.debug("[spawnResourceTransfer] Adding package to state", transfer.transfer_id);
      return [
        ...prev,
        {
          id: transfer.transfer_id,
          type: transfer.resource_type,
          path,
          progress: 0,
          startTime,
          duration
        }
      ];
    });
  }, [features, fallbackCenter, getFeatureCenter, getNearestHubCenter, isLoaded, roadFeaturesForPath]);

  // Listen for transfer events
  useEffect(() => {
    const handleTransfer = (e: Event) => {
      const customEvent = e as CustomEvent<ResourceTransferPayload>;
      spawnResourceTransfer(customEvent.detail);
    };

    window.addEventListener("nightfall:resource_transfer", handleTransfer);
    return () => window.removeEventListener("nightfall:resource_transfer", handleTransfer);
  }, [spawnResourceTransfer]);

  // Animate resource packages
  useEffect(() => {
    if (!isLoaded || !map.current || resourcePackages.length === 0) {
      // Stop animation if no packages
      animationManager.stop('resource-packages');

      // Clean up source if no packages
      if (isLoaded && map.current) {
        const source = map.current.getSource("game-resource-packages") as maplibregl.GeoJSONSource;
        if (source) {
          source.setData({ type: "FeatureCollection", features: [] });
        }
      }
      return;
    }

    const mapInstance = map.current;

    animationManager.start('resource-packages', () => {
      if (!mapInstance) return;

      const now = Date.now();
      const activePackages: ResourcePackage[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const geoFeatures: any[] = [];

      for (const pkg of resourcePackages) {
        const elapsed = now - pkg.startTime;
        const rawProgress = Math.max(0, Math.min(1, elapsed / pkg.duration));

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
      const source = mapInstance.getSource("game-resource-packages") as maplibregl.GeoJSONSource;
      if (source) {
        source.setData({ type: "FeatureCollection", features: geoFeatures });
      }

      // Update state if packages changed
      if (activePackages.length !== resourcePackages.length) {
        setResourcePackages((prev) => {
          const activeIds = new Set(activePackages.map(p => p.id));
          return prev.filter(p => activeIds.has(p.id));
        });
      }

      // Stop animation if all packages completed
      if (activePackages.length === 0) {
        animationManager.stop('resource-packages');
      }
    });

    return () => animationManager.stop('resource-packages');
  }, [resourcePackages, isLoaded, animationManager]);

  useEffect(() => {
    if (!map.current || !isLoaded) return;
    if (mapSize.width === 0 || mapSize.height === 0) return;
    map.current.resize();
  }, [isLoaded, mapSize.width, mapSize.height]);

  const isTransitioning = cycle.phase_progress > 0.9;
  const transitionOpacity = prefersReducedMotion ? 0 : isTransitioning ? 0.15 : 0;
  const transitionGradient = getTransitionGradient(cycle.phase, cycle.next_phase);

  const rootClassName = [
    "relative overflow-hidden rounded-3xl border border-[var(--night-outline)] bg-[#101216] shadow-[0_20px_60px_rgba(0,0,0,0.5)]",
    className
  ]
    .filter(Boolean)
    .join(" ");

  // Cleanup all animations on unmount
  useEffect(() => {
    return () => animationManager.stopAll();
  }, [animationManager]);

  return (
    <div className={rootClassName}>
      <div
        ref={mapShellRef}
        className={`map-shell relative h-full min-h-[520px] w-full phase-${cycle.phase}`}
      >
        <div
          className="phase-transition-overlay"
          style={{
            opacity: transitionOpacity,
            background: transitionGradient
          }}
        />
        <div
          ref={mapContainer}
          className="map-surface absolute inset-0"
          style={{
            filter: PHASE_FILTERS[cycle.phase],
            transition: prefersReducedMotion
              ? "none"
              : "filter 2500ms cubic-bezier(0.4, 0, 0.2, 1)"
          }}
        />
        <MapTooltip tooltip={tooltipData} containerSize={mapSize} />
        {children ? (
          <div className="pointer-events-none absolute inset-0 z-30">
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}
