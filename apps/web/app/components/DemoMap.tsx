"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import * as pmtiles from "pmtiles";
import { cellToBoundary } from "h3-js";
import { MapTooltip, type TooltipData } from "./MapTooltip";
import {
  type ResourcePackage,
  buildResourcePath,
  interpolatePath,
  interpolateWaypoints,
  easeInOutCubic
} from "../lib/resourceAnimation";
import { AnimationManager } from "../lib/animationManager";

// Import from extracted modules
import type {
  CrewPath,
  ResourceTransferPayload,
  DemoMapProps
} from "./map/types";
import {
  PHASE_FILTERS,
  RUST_FILL_OPACITY_BASE,
  RUST_LINE_OPACITY_BASE,
  RUST_PHASE_MULTIPLIER,
  CREW_DASH_SEQUENCE,
  COLORS,
  getTransitionGradient
} from "./map/mapConfig";
import {
  getAllInitialLayers,
  getHexLayers,
  getCrewLayers,
  getCentralHubLayers,
  getCrewPathLayers,
  getResourcePackageLayers,
  BASE_ROAD_FILTER
} from "./map/layers";
import {
  getFeatureCenter,
  getNearestHubCenter,
  getFallbackCenter,
  getMaxBoundsFromBoundary,
  extractRoadFeaturesForPath,
  normalizePercent,
  makeIdFilter
} from "./map/utils";

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

  const animationManager = useMemo(() => new AnimationManager(60), []);
  const breathePhaseRef = useRef(0);
  const hoverTimeoutRef = useRef<number | null>(null);
  const tooltipDismissRef = useRef<number | null>(null);
  const featuresRef = useRef(features);
  const tasksRef = useRef(tasks);

  const pmtilesBase = useMemo(
    () => `https://d3c1b7bog2u1nn.cloudfront.net/${pmtilesRelease}`,
    [pmtilesRelease]
  );

  const fallbackCenter = useMemo<[number, number]>(
    () => getFallbackCenter(fallbackBbox),
    [fallbackBbox]
  );

  const repairingRoadIds = useMemo(() => {
    const ids = tasks
      .filter(t => t.status === "in_progress")
      .map(t => t.target_gers_id)
      .filter((id): id is string => Boolean(id));
    return Array.from(new Set(ids));
  }, [tasks]);

  const roadFeaturesForPath = useMemo(
    () => extractRoadFeaturesForPath(features),
    [features]
  );

  const travelingCrewIds = useMemo(
    () => new Set(crewPaths.map((path) => path.crew_id)),
    [crewPaths]
  );

  // Media query effects
  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mobileQuery = window.matchMedia("(max-width: 768px)");

    const update = () => {
      setPrefersReducedMotion(motionQuery.matches);
      setIsMobile(mobileQuery.matches);
    };

    update();
    motionQuery.addEventListener("change", update);
    mobileQuery.addEventListener("change", update);
    return () => {
      motionQuery.removeEventListener("change", update);
      mobileQuery.removeEventListener("change", update);
    };
  }, []);

  // Resize observer
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

  // Track queued task road IDs
  useEffect(() => {
    const ids = tasks
      .filter((t) => t.status === "queued" || t.status === "pending")
      .map((t) => t.target_gers_id)
      .filter((id): id is string => Boolean(id));
    setQueuedTaskRoadIds(Array.from(new Set(ids)));
  }, [tasks]);

  // Keep refs updated
  useEffect(() => { featuresRef.current = features; }, [features]);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  // Map initialization
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    setIsLoaded(false);
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);

    const centerLon = (fallbackBbox.xmin + fallbackBbox.xmax) / 2;
    const centerLat = (fallbackBbox.ymin + fallbackBbox.ymax) / 2;
    const maxBounds = getMaxBoundsFromBoundary(boundary);

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
        layers: getAllInitialLayers()
      },
      center: [centerLon, centerLat],
      zoom: 14,
      pitch: 45
    });
    map.current = mapInstance;

    mapInstance.on("load", () => {
      // Add boundary mask
      if (boundary) {
        map.current?.addSource("game-boundary-mask", {
          type: "geojson",
          data: {
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [
                [[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]],
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

      // Add hex source and layers
      map.current?.addSource("game-hexes", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });

      const hexLayers = getHexLayers();
      map.current?.addLayer(hexLayers.fill as maplibregl.AddLayerObject, "game-roads-healthy-glow");
      map.current?.addLayer(hexLayers.outline as maplibregl.AddLayerObject, "game-roads-healthy-glow");

      // Add crews source and layers
      map.current?.addSource("game-crews", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });

      for (const layer of getCrewLayers()) {
        map.current?.addLayer(layer as maplibregl.AddLayerObject);
      }

      // Add central hub source and layers
      map.current?.addSource("game-central-hub", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });

      for (const layer of getCentralHubLayers()) {
        map.current?.addLayer(layer as maplibregl.AddLayerObject);
      }

      // Add crew paths source and layers
      map.current?.addSource("game-crew-paths", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });
      map.current?.addSource("game-crew-markers", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });

      const crewPathLayers = getCrewPathLayers();
      map.current?.addLayer(crewPathLayers[0] as maplibregl.AddLayerObject, "game-crews-point");
      map.current?.addLayer(crewPathLayers[1] as maplibregl.AddLayerObject);

      // Add resource packages source and layers
      map.current?.addSource("game-resource-packages", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });

      for (const layer of getResourcePackageLayers()) {
        map.current?.addLayer(layer as maplibregl.AddLayerObject);
      }

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

        mapInstance.setFilter("game-feature-selection", ["==", ["get", "id"], gersId]);
        mapInstance.setFilter("game-feature-selection-glow", ["==", ["get", "id"], gersId]);

        window.dispatchEvent(new CustomEvent("nightfall:feature_selected", {
          detail: { gers_id: gersId, type, position: { x: e.point.x, y: e.point.y } }
        }));
      } else {
        mapInstance.setFilter("game-feature-selection", ["==", ["get", "id"], "none"]);
        mapInstance.setFilter("game-feature-selection-glow", ["==", ["get", "id"], "none"]);
        window.dispatchEvent(new CustomEvent("nightfall:feature_selected", { detail: null }));
      }
    });

    // Hover handlers
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

  // Tooltip handling
  useEffect(() => {
    if (!isLoaded || !map.current) return;

    const mapInstance = map.current;
    const tooltipLayers = [
      "game-roads-healthy", "game-roads-warning", "game-roads-degraded",
      "roads-low", "roads-mid", "roads-high", "roads-routes",
      "buildings", "buildings-food", "buildings-equipment", "buildings-energy", "buildings-materials", "buildings-hub", "game-hex-fill"
    ];

    const buildTooltipData = (
      feature: maplibregl.MapGeoJSONFeature,
      point: maplibregl.Point
    ): TooltipData | null => {
      const layerId = feature.layer.id;
      const gersId = feature.properties?.id as string | undefined;

      if (layerId.includes("hex")) {
        const rust = normalizePercent(Number(feature.properties?.rust_level));
        return { type: "hex", position: { x: point.x, y: point.y }, data: { rust_level: rust } };
      }

      if (layerId.includes("buildings") || layerId.includes("building")) {
        const match = gersId ? featuresRef.current.find((f) => f.gers_id === gersId) : null;
        return {
          type: "building",
          position: { x: point.x, y: point.y },
          data: {
            category: match?.place_category ?? feature.properties?.class ?? "Building",
            generates_food: Boolean(match?.generates_food),
            generates_equipment: Boolean(match?.generates_equipment),
            generates_energy: Boolean(match?.generates_energy),
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
      const featuresAtPoint = mapInstance.queryRenderedFeatures(point, { layers: tooltipLayers });
      if (!featuresAtPoint.length) {
        setTooltipData(null);
        return;
      }

      const nonHexFeature = featuresAtPoint.find(f => !f.layer.id.includes("hex"));
      const topFeature = nonHexFeature ?? featuresAtPoint[0];
      setTooltipData(buildTooltipData(topFeature, point));
    };

    const scheduleTooltip = (point: maplibregl.Point) => {
      if (hoverTimeoutRef.current) window.clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = window.setTimeout(() => resolveTooltip(point), 200);
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

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      if (!isMobile) return;
      resolveTooltip(e.point);
      if (tooltipDismissRef.current) window.clearTimeout(tooltipDismissRef.current);
      tooltipDismissRef.current = window.setTimeout(() => setTooltipData(null), 3000);
    };

    mapInstance.on("mousemove", handleMouseMove);
    mapInstance.on("click", handleClick);
    mapInstance.getCanvas().addEventListener("mouseleave", clearTooltip);

    return () => {
      mapInstance.off("mousemove", handleMouseMove);
      mapInstance.off("click", handleClick);
      mapInstance.getCanvas().removeEventListener("mouseleave", clearTooltip);
      clearTooltip();
    };
  }, [isLoaded, isMobile]);

  // Sync health data to vector tile features
  useEffect(() => {
    if (!isLoaded || !map.current) return;

    const healthyIds = features.filter(f => f.feature_type === "road" && (f.health ?? 100) > 80).map(f => f.gers_id);
    const warningIds = features.filter(f => f.feature_type === "road" && (f.health ?? 100) <= 80 && (f.health ?? 100) > 30).map(f => f.gers_id);
    const degradedIds = features.filter(f => f.feature_type === "road" && (f.health ?? 100) <= 30).map(f => f.gers_id);
    const foodIds = features.filter(f => f.feature_type === "building" && f.generates_food).map(f => f.gers_id);
    const equipmentIds = features.filter(f => f.feature_type === "building" && f.generates_equipment).map(f => f.gers_id);
    const energyIds = features.filter(f => f.feature_type === "building" && f.generates_energy).map(f => f.gers_id);
    const materialIds = features.filter(f => f.feature_type === "building" && f.generates_materials).map(f => f.gers_id);
    const hubIds = features.filter(f => f.feature_type === "building" && f.is_hub).map(f => f.gers_id);

    map.current.setFilter("game-roads-healthy", ["all", BASE_ROAD_FILTER, makeIdFilter(healthyIds)] as maplibregl.FilterSpecification);
    map.current.setFilter("game-roads-healthy-glow", ["all", BASE_ROAD_FILTER, makeIdFilter(healthyIds)] as maplibregl.FilterSpecification);
    map.current.setFilter("game-roads-warning", ["all", BASE_ROAD_FILTER, makeIdFilter(warningIds)] as maplibregl.FilterSpecification);
    map.current.setFilter("game-roads-warning-glow", ["all", BASE_ROAD_FILTER, makeIdFilter(warningIds)] as maplibregl.FilterSpecification);
    map.current.setFilter("game-roads-degraded", ["all", BASE_ROAD_FILTER, makeIdFilter(degradedIds)] as maplibregl.FilterSpecification);
    map.current.setFilter("game-roads-degraded-glow", ["all", BASE_ROAD_FILTER, makeIdFilter(degradedIds)] as maplibregl.FilterSpecification);
    map.current.setFilter("buildings-food", makeIdFilter(foodIds) as maplibregl.FilterSpecification);
    map.current.setFilter("buildings-equipment", makeIdFilter(equipmentIds) as maplibregl.FilterSpecification);
    map.current.setFilter("buildings-energy", makeIdFilter(energyIds) as maplibregl.FilterSpecification);
    map.current.setFilter("buildings-materials", makeIdFilter(materialIds) as maplibregl.FilterSpecification);
    map.current.setFilter("buildings-hub", makeIdFilter(hubIds) as maplibregl.FilterSpecification);
    map.current.setFilter("buildings-hub-glow", makeIdFilter(hubIds) as maplibregl.FilterSpecification);
  }, [features, isLoaded]);

  // Sync all hub markers
  useEffect(() => {
    if (!isLoaded || !map.current) return;

    const hubFeatures = features.filter((f) => f.feature_type === "building" && f.is_hub);
    const hubSource = map.current.getSource("game-central-hub") as maplibregl.GeoJSONSource | undefined;
    if (!hubSource) return;

    if (hubFeatures.length === 0) {
      hubSource.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    const hubPoints: GeoJSON.Feature<GeoJSON.Point>[] = [];
    for (const hub of hubFeatures) {
      const center = getFeatureCenter(hub);
      if (!center) continue;
      hubPoints.push({
        type: "Feature" as const,
        properties: { gers_id: hub.gers_id },
        geometry: { type: "Point" as const, coordinates: center }
      });
    }

    hubSource.setData({
      type: "FeatureCollection",
      features: hubPoints
    });
  }, [features, isLoaded]);

  // Sync hex data
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
              type: "Feature" as const,
              geometry: { type: "Polygon" as const, coordinates },
              properties: { h3_index: h.h3_index, rust_level: h.rust_level }
            };
          } catch (e) {
            console.error("Failed to calculate boundary for hex", h.h3_index, e);
            return null;
          }
        }).filter((f): f is NonNullable<typeof f> => f !== null)
      });
    }
  }, [hexes, isLoaded]);

  // Build crew travel paths
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

      const hubCenter = getNearestHubCenter(features, destination) ?? fallbackCenter;
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
  }, [crews, tasks, features, roadFeaturesForPath, fallbackCenter]);

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

      const coords = getFeatureCenter(feature);
      if (!coords) return null;

      return {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: coords },
        properties: { ...crew }
      };
    }).filter((f): f is NonNullable<typeof f> => f !== null);

    const source = map.current.getSource("game-crews") as maplibregl.GeoJSONSource;
    if (source) {
      source.setData({ type: "FeatureCollection", features: crewFeatures });
    }
  }, [crews, tasks, features, isLoaded, travelingCrewIds]);

  // Sync crew path data
  useEffect(() => {
    if (!isLoaded || !map.current) return;

    const pathSource = map.current.getSource("game-crew-paths") as maplibregl.GeoJSONSource;
    if (pathSource) {
      pathSource.setData({
        type: "FeatureCollection",
        features: crewPaths.map((cp) => ({
          type: "Feature" as const,
          properties: { crew_id: cp.crew_id },
          geometry: { type: "LineString" as const, coordinates: cp.path }
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

    animationManager.stop('crew-paths');
    if (crewPaths.length === 0) return;

    const mapInstance = map.current;
    const markerSource = mapInstance.getSource("game-crew-markers") as maplibregl.GeoJSONSource | undefined;
    if (!markerSource) return;

    const updateMarkers = (now: number) => {
      const markerFeatures = crewPaths.map((cp) => {
        const duration = Math.max(1, cp.endTime - cp.startTime);
        const progress = Math.max(0, Math.min(1, (now - cp.startTime) / duration));
        const position = interpolatePath(cp.path, progress);

        return {
          type: "Feature" as const,
          properties: { crew_id: cp.crew_id },
          geometry: { type: "Point" as const, coordinates: position }
        };
      });

      markerSource.setData({ type: "FeatureCollection", features: markerFeatures });
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

  // Task completion animation
  useEffect(() => {
    const handleTaskCompleted = (e: Event) => {
      const customEvent = e as CustomEvent<{ gers_id: string }>;
      const gersId = customEvent.detail.gers_id;

      if (!map.current || !isLoaded) return;

      const baseFilter: maplibregl.FilterSpecification = ["all",
        ["==", ["get", "subtype"], "road"],
        ["==", ["get", "id"], gersId]
      ];

      map.current.setFilter("game-roads-completion-flash", baseFilter);
      map.current.setPaintProperty("game-roads-completion-flash", "line-opacity", 0.9);

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

  // Animate repair pulse
  useEffect(() => {
    if (!isLoaded || !map.current) return;

    const baseFilter: maplibregl.FilterSpecification = ["all",
      ["==", ["get", "subtype"], "road"],
      ["in", ["get", "id"], ["literal", repairingRoadIds.length ? repairingRoadIds : ["__none__"]]]
    ];

    map.current.setFilter("game-roads-repair-pulse", baseFilter);
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

  // Rust opacity transitions
  useEffect(() => {
    if (!isLoaded || !map.current) return;

    map.current.setPaintProperty("game-hex-fill", "fill-opacity-transition", { duration: 1000, delay: 0 });
    map.current.setPaintProperty("game-hex-outline", "line-opacity-transition", { duration: 1000, delay: 0 });
  }, [isLoaded]);

  // Animate rust "breathing"
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

    animationManager.stop('rust-breathing');

    if (prefersReducedMotion || (cycle.phase !== "night" && cycle.phase !== "dusk")) {
      applyStaticOpacity(phaseMultiplier);
      return;
    }

    animationManager.start('rust-breathing', () => {
      breathePhaseRef.current += 0.015;
      const pulse = 1 + 0.1 * Math.sin(breathePhaseRef.current);
      applyStaticOpacity(pulse * phaseMultiplier);
    });

    return () => animationManager.stop('rust-breathing');
  }, [cycle.phase, isLoaded, prefersReducedMotion, animationManager]);

  // Resource transfer spawning
  const spawnResourceTransfer = useCallback((transfer: ResourceTransferPayload) => {
    if (!isLoaded) return;

    const departAt = Date.parse(transfer.depart_at);
    const arriveAt = Date.parse(transfer.arrive_at);
    const startTime = Number.isNaN(departAt) ? Date.now() : departAt;
    const endTime = (Number.isNaN(arriveAt) ? startTime + 4000 : arriveAt) + 10000;

    if (Date.now() >= endTime) return;

    const sourceFeature = transfer.source_gers_id
      ? features.find((f) => f.gers_id === transfer.source_gers_id)
      : null;
    const hubFeature = transfer.hub_gers_id
      ? features.find((f) => f.gers_id === transfer.hub_gers_id)
      : null;

    const sourceCenter = sourceFeature ? getFeatureCenter(sourceFeature) : fallbackCenter;
    const hubCenter = hubFeature
      ? getFeatureCenter(hubFeature)
      : getNearestHubCenter(features, sourceCenter) ?? fallbackCenter;

    if (!sourceCenter || !hubCenter) return;

    console.debug("[spawnResourceTransfer]", {
      transferId: transfer.transfer_id,
      sourceGersId: transfer.source_gers_id,
      hubGersId: transfer.hub_gers_id,
      sourceCenter,
      hubCenter,
      roadCount: roadFeaturesForPath.length,
      sourceFeatureFound: !!sourceFeature,
      hubFeatureFound: !!hubFeature
    });

    // Use server-provided waypoints if available, otherwise build client-side path
    const waypoints = transfer.path_waypoints;
    const path = waypoints && waypoints.length > 0
      ? waypoints.map((w) => w.coord)
      : buildResourcePath(sourceCenter, hubCenter, roadFeaturesForPath);

    console.debug("[spawnResourceTransfer] path built", {
      pathLength: path.length,
      hasServerWaypoints: !!(waypoints && waypoints.length > 0),
      path
    });

    const duration = Math.max(1000, endTime - startTime);

    setResourcePackages((prev) => {
      if (prev.some((pkg) => pkg.id === transfer.transfer_id)) return prev;
      return [...prev, {
        id: transfer.transfer_id,
        type: transfer.resource_type,
        path,
        progress: 0,
        startTime,
        duration,
        waypoints: waypoints && waypoints.length > 0 ? waypoints : null
      }];
    });
  }, [features, fallbackCenter, isLoaded, roadFeaturesForPath]);

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
      animationManager.stop('resource-packages');

      if (isLoaded && map.current) {
        const source = map.current.getSource("game-resource-packages") as maplibregl.GeoJSONSource;
        if (source) source.setData({ type: "FeatureCollection", features: [] });
      }
      return;
    }

    const mapInstance = map.current;

    animationManager.start('resource-packages', () => {
      if (!mapInstance) return;

      const now = Date.now();
      const activePackages: ResourcePackage[] = [];
      const geoFeatures: GeoJSON.Feature[] = [];

      for (const pkg of resourcePackages) {
        let position: [number, number] | null = null;
        let rawProgress: number;

        // Use waypoint-based animation if available (server-provided with timestamps)
        if (pkg.waypoints && pkg.waypoints.length > 0) {
          position = interpolateWaypoints(pkg.waypoints, now);
          if (!position) continue; // Animation complete

          // Calculate progress from waypoint timestamps
          const firstTime = Date.parse(pkg.waypoints[0].arrive_at);
          const lastTime = Date.parse(pkg.waypoints[pkg.waypoints.length - 1].arrive_at);
          rawProgress = Math.max(0, Math.min(1, (now - firstTime) / (lastTime - firstTime)));
        } else {
          // Fallback to uniform progress-based animation
          const elapsed = now - pkg.startTime;
          rawProgress = Math.max(0, Math.min(1, elapsed / pkg.duration));

          if (rawProgress >= 1) continue;

          const easedProgress = easeInOutCubic(rawProgress);
          position = interpolatePath(pkg.path, easedProgress) as [number, number];
        }

        // Calculate opacity for fade in/out
        let opacity = 1;
        if (rawProgress < 0.1) opacity = rawProgress / 0.1;
        else if (rawProgress > 0.9) opacity = (1 - rawProgress) / 0.1;

        // Build trail
        const trailCoords: [number, number][] = [];
        if (pkg.waypoints && pkg.waypoints.length > 0) {
          // For waypoint animation, include all waypoints up to current position
          for (const wp of pkg.waypoints) {
            const wpTime = Date.parse(wp.arrive_at);
            if (wpTime <= now) {
              trailCoords.push(wp.coord);
            } else {
              break;
            }
          }
          if (position) trailCoords.push(position);
        } else {
          // For uniform animation, sample along the path
          const easedProgress = easeInOutCubic(rawProgress);
          for (let t = 0; t <= easedProgress; t += 0.02) {
            trailCoords.push(interpolatePath(pkg.path, t) as [number, number]);
          }
        }

        if (trailCoords.length > 1) {
          geoFeatures.push({
            type: "Feature" as const,
            geometry: { type: "LineString" as const, coordinates: trailCoords },
            properties: { featureType: "trail", resourceType: pkg.type }
          });
        }

        geoFeatures.push({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: position },
          properties: { featureType: "package", resourceType: pkg.type, opacity }
        });

        activePackages.push({ ...pkg, progress: rawProgress });
      }

      const source = mapInstance.getSource("game-resource-packages") as maplibregl.GeoJSONSource;
      if (source) source.setData({ type: "FeatureCollection", features: geoFeatures });

      if (activePackages.length !== resourcePackages.length) {
        setResourcePackages((prev) => {
          const activeIds = new Set(activePackages.map(p => p.id));
          return prev.filter(p => activeIds.has(p.id));
        });
      }

      if (activePackages.length === 0) {
        animationManager.stop('resource-packages');
      }
    });

    return () => animationManager.stop('resource-packages');
  }, [resourcePackages, isLoaded, animationManager]);

  // Map resize sync
  useEffect(() => {
    if (!map.current || !isLoaded) return;
    if (mapSize.width === 0 || mapSize.height === 0) return;
    map.current.resize();
  }, [isLoaded, mapSize.width, mapSize.height]);

  // Cleanup animations on unmount
  useEffect(() => {
    return () => animationManager.stopAll();
  }, [animationManager]);

  const isTransitioning = cycle.phase_progress > 0.9;
  const transitionOpacity = prefersReducedMotion ? 0 : isTransitioning ? 0.15 : 0;
  const transitionGradient = getTransitionGradient(cycle.phase, cycle.next_phase);

  const rootClassName = [
    "relative overflow-hidden rounded-3xl border border-[var(--night-outline)] bg-[#101216] shadow-[0_20px_60px_rgba(0,0,0,0.5)]",
    className
  ].filter(Boolean).join(" ");

  return (
    <div className={rootClassName}>
      <div
        ref={mapShellRef}
        className={`map-shell relative h-full min-h-[520px] w-full phase-${cycle.phase}`}
      >
        <div
          className="phase-transition-overlay"
          style={{ opacity: transitionOpacity, background: transitionGradient }}
        />
        <div
          ref={mapContainer}
          className="map-surface absolute inset-0"
          style={{
            filter: PHASE_FILTERS[cycle.phase],
            transition: prefersReducedMotion ? "none" : "filter 2500ms cubic-bezier(0.4, 0, 0.2, 1)"
          }}
        />
        <MapTooltip tooltip={tooltipData} containerSize={mapSize} />
        {children ? (
          <div className="pointer-events-none absolute inset-0 z-30">{children}</div>
        ) : null}
      </div>
    </div>
  );
}
