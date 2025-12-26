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
  health?: number | null;
  status?: string | null;
  road_class?: string | null;
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

export default function DemoMap({ boundary, features, hexes, fallbackBbox, cycle }: DemoMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (!mapContainer.current) return;

    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);

    const centerLon = (fallbackBbox.xmin + fallbackBbox.xmax) / 2;
    const centerLat = (fallbackBbox.ymin + fallbackBbox.ymax) / 2;

    const baseRoadFilter = ["all", 
      ["==", ["get", "subtype"], "road"],
      ["in", ["get", "class"], ["literal", ROAD_CLASS_FILTER]]
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
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#0d0d0f" }
          },
          {
            id: "landuse",
            source: "overture_base",
            "source-layer": "land_use",
            type: "fill",
            paint: { "fill-color": "#111114" }
          },
          {
            id: "water",
            source: "overture_base",
            "source-layer": "water",
            type: "fill",
            paint: { "fill-color": "#020406" }
          },
          {
            id: "buildings",
            source: "overture_buildings",
            "source-layer": "building",
            type: "fill",
            paint: {
              "fill-color": "#18181d",
              "fill-opacity": 0.9,
              "fill-outline-color": "#222228"
            }
          },
          {
            id: "roads-low",
            source: "overture_transportation",
            "source-layer": "segment",
            type: "line",
            filter: ["all", baseRoadFilter, ["in", ["get", "class"], ["literal", ["residential", "service"]]]],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#1a1a20", "line-width": 0.6 }
          },
          {
            id: "roads-mid",
            source: "overture_transportation",
            "source-layer": "segment",
            type: "line",
            filter: ["all", baseRoadFilter, ["in", ["get", "class"], ["literal", ["primary", "secondary", "tertiary"]]]],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#22222c", "line-width": 1.2 }
          },
          {
            id: "roads-high",
            source: "overture_transportation",
            "source-layer": "segment",
            type: "line",
            filter: ["all", baseRoadFilter, ["in", ["get", "class"], ["literal", ["motorway", "trunk"]]]],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#2a2a38", "line-width": 1.8 }
          },
          // Game State Highlight Layers
          {
            id: "game-roads-healthy",
            source: "overture_transportation",
            "source-layer": "segment",
            type: "line",
            filter: ["all", baseRoadFilter, ["==", ["get", "id"], "none"]],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#3eb0c0",
              "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 16, 3],
              "line-opacity": 0.4
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
              "line-color": "#f08a4e",
              "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.2, 16, 4],
              "line-opacity": 0.5
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
              "line-color": "#e03a30",
              "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.5, 16, 5],
              "line-opacity": 0.6
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
              "line-color": "#ffffff",
              "line-width": ["interpolate", ["linear"], ["zoom"], 12, 3, 16, 8],
              "line-opacity": 0.4
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

      // Add hex fill layer (rust gradient)
      map.current?.addLayer({
        id: "game-hex-fill",
        type: "fill",
        source: "game-hexes",
        paint: {
          "fill-color": [
            "interpolate",
            ["linear"],
            ["get", "rust_level"],
            0, "#3eb0c0",
            0.5, "#f08a4e",
            1, "#e03a30"
          ],
          "fill-opacity": 0.1
        }
      }, "game-roads-healthy");

      // Add hex outline layer
      map.current?.addLayer({
        id: "game-hex-outline",
        type: "line",
        source: "game-hexes",
        paint: {
          "line-color": [
            "interpolate",
            ["linear"],
            ["get", "rust_level"],
            0, "#3eb0c0",
            0.5, "#f08a4e",
            1, "#e03a30"
          ],
          "line-width": 1,
          "line-opacity": 0.3
        }
      }, "game-roads-healthy");

      setIsLoaded(true);
    });

    map.current.on("click", (e) => {
      const features = map.current?.queryRenderedFeatures(e.point, {
        layers: ["game-roads-healthy", "game-roads-warning", "game-roads-degraded", "roads-low", "roads-mid", "roads-high", "buildings"]
      });

      if (features && features.length > 0) {
        const feature = features[0];
        const gersId = feature.properties?.id;
        const type = feature.layer.id.includes("buildings") ? "building" : "road";
        
        map.current?.setFilter("game-feature-selection", ["==", ["get", "id"], gersId]);
        
        window.dispatchEvent(new CustomEvent("nightfall:feature_selected", { 
          detail: { gers_id: gersId, type } 
        }));
      } else {
        map.current?.setFilter("game-feature-selection", ["==", ["get", "id"], "none"]);
        window.dispatchEvent(new CustomEvent("nightfall:feature_selected", { 
          detail: null 
        }));
      }
    });

    map.current.on("mouseenter", "game-roads-healthy", () => {
      if (map.current) map.current.getCanvas().style.cursor = "pointer";
    });
    map.current.on("mouseleave", "game-roads-healthy", () => {
      if (map.current) map.current.getCanvas().style.cursor = "";
    });

    return () => {
      map.current?.remove();
      maplibregl.removeProtocol("pmtiles");
    };
  }, []);

  // Sync health data to vector tile features
  useEffect(() => {
    if (!isLoaded || !map.current) return;

    const healthyIds = features.filter(f => f.feature_type === "road" && (f.health ?? 100) > 80).map(f => f.gers_id);
    const warningIds = features.filter(f => f.feature_type === "road" && (f.health ?? 100) <= 80 && (f.health ?? 100) > 30).map(f => f.gers_id);
    const degradedIds = features.filter(f => f.feature_type === "road" && (f.health ?? 100) <= 30).map(f => f.gers_id);

    const baseFilter = ["all", 
      ["==", ["get", "subtype"], "road"],
      ["in", ["get", "class"], ["literal", ROAD_CLASS_FILTER]]
    ];

    map.current.setFilter("game-roads-healthy", ["all", baseFilter, ["in", ["get", "id"], ["literal", healthyIds.length ? healthyIds : ["none"]]]]);
    map.current.setFilter("game-roads-warning", ["all", baseFilter, ["in", ["get", "id"], ["literal", warningIds.length ? warningIds : ["none"]]]]);
    map.current.setFilter("game-roads-degraded", ["all", baseFilter, ["in", ["get", "id"], ["literal", degradedIds.length ? degradedIds : ["none"]]]]);

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
        }).filter(Boolean) as any
      });
    }
  }, [hexes, isLoaded]);

  return (
    <div className="relative overflow-hidden rounded-3xl border border-[var(--night-outline)] bg-[#0d0d0f] shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
      <div className="absolute top-0 z-10 flex w-full items-center justify-between border-b border-white/5 bg-[#0d0d0f]/80 px-6 py-4 text-sm uppercase tracking-[0.3em] text-[color:var(--night-ash)] backdrop-blur-md">
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
