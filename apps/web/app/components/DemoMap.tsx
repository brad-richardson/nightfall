"use client";

import React, { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import * as pmtiles from "pmtiles";
import { cellToBoundary } from "h3-js";
import { ROAD_CLASS_FILTER } from "@nightfall/config";

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
};

type Crew = {
  crew_id: string;
  status: string;
  active_task_id: string | null;
};

type Task = {
  task_id: string;
  target_gers_id: string;
};

type Hex = {
  h3_index: string;
  rust_level: number;
};

type Bbox = {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
};

type DemoMapProps = {
  features: Feature[];
  hexes: Hex[];
  crews: Crew[];
  tasks: Task[];
  fallbackBbox: Bbox;
  cycle: {
    phase: "dawn" | "day" | "dusk" | "night";
    phase_progress: number;
  };
};

const RELEASE = "2025-12-17";
const PMTILES_BASE = `https://d3c1b7bog2u1nn.cloudfront.net/${RELEASE}`;

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

export default function DemoMap({ features, hexes, crews, tasks, fallbackBbox, cycle }: DemoMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (!mapContainer.current) return;

    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);

    const centerLon = (fallbackBbox.xmin + fallbackBbox.xmax) / 2;
    const centerLat = (fallbackBbox.ymin + fallbackBbox.ymax) / 2;

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
      style: {
        version: 8,
        name: "Nightfall Hex Dystopian",
        sources: {
          overture_base: {
            type: "vector",
            url: `pmtiles://${PMTILES_BASE}/base.pmtiles`,
            attribution: "Overture Maps"
          },
          overture_transportation: {
            type: "vector",
            url: `pmtiles://${PMTILES_BASE}/transportation.pmtiles`,
            attribution: "Overture Maps"
          },
          overture_buildings: {
            type: "vector",
            url: `pmtiles://${PMTILES_BASE}/buildings.pmtiles`,
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
              "fill-opacity": 0.9,
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
              "fill-opacity": 0.9,
              "fill-outline-color": COLORS.buildingOutline
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
      // Add source for hex cells
      map.current?.addSource("game-hexes", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: []
        }
      });

      // Add hex fill layer with improved visibility (rust-based opacity)
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
          "fill-opacity": [
            "interpolate",
            ["linear"],
            ["get", "rust_level"],
            0, 0.12,
            0.5, 0.22,
            1, 0.35
          ]
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
          "line-width": [
            "interpolate",
            ["linear"],
            ["get", "rust_level"],
            0, 1,
            0.5, 1.5,
            1, 2.5
          ],
          "line-opacity": [
            "interpolate",
            ["linear"],
            ["get", "rust_level"],
            0, 0.25,
            0.5, 0.45,
            1, 0.65
          ]
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
          "circle-radius": 6,
          "circle-color": "#ffffff",
          "circle-stroke-width": 2,
          "circle-stroke-color": COLORS.healthy
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
  }, [fallbackBbox]);

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

  }, [features, isLoaded]);

  // Sync hex data to GeoJSON source
  useEffect(() => {
    if (!isLoaded || !map.current || !hexes.length) return;

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