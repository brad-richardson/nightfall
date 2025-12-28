"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import * as pmtiles from "pmtiles";
import { cellToBoundary, cellToLatLng } from "h3-js";
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
  RESOURCE_COLORS,
  getTransitionGradient,
  loadConstructionVehicleIcon
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
import { useStore } from "../store";

export default function DemoMap({
  boundary,
  features,
  hexes,
  crews,
  tasks,
  fallbackBbox,
  focusH3Index,
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
  const [arrivalParticles, setArrivalParticles] = useState<{
    id: string;
    x: number;
    y: number;
    amount: number;
    resourceType: string;
    createdAt: number;
  }[]>([]);

  const animationManager = useMemo(() => new AnimationManager(60), []);
  const breathePhaseRef = useRef(0);
  const hoverTimeoutRef = useRef<number | null>(null);
  const completedPackageIds = useRef<Set<string>>(new Set());
  const tooltipDismissRef = useRef<number | null>(null);
  const fadeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const featuresRef = useRef(features);
  const tasksRef = useRef(tasks);
  const resourcePackagesRef = useRef(resourcePackages);
  const hasOvertureSources = !!pmtilesRelease;
  // Initialize with empty Maps - will be updated via useEffect after memos are computed
  const featuresByGersIdRef = useRef<Map<string, typeof features[0]>>(new Map());
  const tasksByGersIdRef = useRef<Map<string, typeof tasks[0]>>(new Map());

  const pmtilesBase = useMemo(
    () => pmtilesRelease ? `https://d3c1b7bog2u1nn.cloudfront.net/${pmtilesRelease}` : null,
    [pmtilesRelease]
  );

  const fallbackCenter = useMemo<[number, number]>(
    () => getFallbackCenter(fallbackBbox),
    [fallbackBbox]
  );

  const repairingRoadIds = useMemo(() => {
    const ids = tasks
      .filter(t => t.status === "active")
      .map(t => t.target_gers_id)
      .filter((id): id is string => Boolean(id));
    return Array.from(new Set(ids));
  }, [tasks]);

  const roadFeaturesForPath = useMemo(
    () => extractRoadFeaturesForPath(features),
    [features]
  );

  // Pre-compute all filter ID arrays once when features change
  // This avoids O(n) filter array recreation on every render
  const featureFilterIds = useMemo(() => {
    const VISUAL_DEGRADED_THRESHOLD = 30;
    const healthyIds: string[] = [];
    const degradedIds: string[] = [];
    const foodIds: string[] = [];
    const equipmentIds: string[] = [];
    const energyIds: string[] = [];
    const materialIds: string[] = [];
    const hubIds: string[] = [];

    // Single pass through features to categorize all IDs
    for (const f of features) {
      if (f.feature_type === "road") {
        if ((f.health ?? 100) > VISUAL_DEGRADED_THRESHOLD) {
          healthyIds.push(f.gers_id);
        } else {
          degradedIds.push(f.gers_id);
        }
      } else if (f.feature_type === "building") {
        if (f.generates_food) foodIds.push(f.gers_id);
        if (f.generates_equipment) equipmentIds.push(f.gers_id);
        if (f.generates_energy) energyIds.push(f.gers_id);
        if (f.generates_materials) materialIds.push(f.gers_id);
        if (f.is_hub) hubIds.push(f.gers_id);
      }
    }

    return { healthyIds, degradedIds, foodIds, equipmentIds, energyIds, materialIds, hubIds };
  }, [features]);

  const travelingCrewIds = useMemo(
    () => new Set(crewPaths.map((path) => path.crew_id)),
    [crewPaths]
  );

  // Get building boosts from store and compute active boost IDs
  const buildingBoosts = useStore((state) => state.buildingBoosts);
  const activeBoostedBuildingIds = useMemo(() => {
    const now = Date.now();
    return Object.values(buildingBoosts)
      .filter((boost) => new Date(boost.expires_at).getTime() > now)
      .map((boost) => boost.building_gers_id);
  }, [buildingBoosts]);

  // ID-indexed Maps for O(1) lookups instead of O(n) array.find()
  const featuresByGersId = useMemo(() => {
    const map = new Map<string, typeof features[0]>();
    for (const f of features) {
      map.set(f.gers_id, f);
    }
    return map;
  }, [features]);

  // Note: The database enforces one active/queued task per target_gers_id via
  // unique constraint, so this Map won't lose data in practice
  const tasksByGersId = useMemo(() => {
    const map = new Map<string, typeof tasks[0]>();
    for (const t of tasks) {
      if (t.target_gers_id) {
        map.set(t.target_gers_id, t);
      }
    }
    return map;
  }, [tasks]);

  const tasksById = useMemo(() => {
    const map = new Map<string, typeof tasks[0]>();
    for (const t of tasks) {
      map.set(t.task_id, t);
    }
    return map;
  }, [tasks]);

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

  // Keep refs updated for use in event handlers
  useEffect(() => { featuresRef.current = features; }, [features]);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  useEffect(() => { resourcePackagesRef.current = resourcePackages; }, [resourcePackages]);
  useEffect(() => { featuresByGersIdRef.current = featuresByGersId; }, [featuresByGersId]);
  useEffect(() => { tasksByGersIdRef.current = tasksByGersId; }, [tasksByGersId]);

  // Map initialization
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    setIsLoaded(false);
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);

    // Center on focus hex if available, otherwise use bbox center
    let centerLon: number;
    let centerLat: number;
    if (focusH3Index) {
      const [lat, lon] = cellToLatLng(focusH3Index);
      centerLon = lon;
      centerLat = lat;
    } else {
      centerLon = (fallbackBbox.xmin + fallbackBbox.xmax) / 2;
      centerLat = (fallbackBbox.ymin + fallbackBbox.ymax) / 2;
    }
    const maxBounds = getMaxBoundsFromBoundary(boundary);

    // Build sources - only include Overture sources when pmtilesBase is available
    const sources: maplibregl.StyleSpecification["sources"] = {};
    if (pmtilesBase) {
      sources.overture_base = {
        type: "vector",
        url: `pmtiles://${pmtilesBase}/base.pmtiles`,
        attribution: "Overture Maps"
      };
      sources.overture_transportation = {
        type: "vector",
        url: `pmtiles://${pmtilesBase}/transportation.pmtiles`,
        attribution: "Overture Maps"
      };
      sources.overture_buildings = {
        type: "vector",
        url: `pmtiles://${pmtilesBase}/buildings.pmtiles`,
        attribution: "Overture Maps"
      };
    }

    const mapInstance = new maplibregl.Map({
      container: mapContainer.current,
      maxBounds,
      style: {
        version: 8,
        name: "Nightfall Hex Dystopian",
        sources,
        layers: getAllInitialLayers(!!pmtilesBase)
      },
      center: [centerLon, centerLat],
      zoom: 14,
      pitch: 45
    });
    map.current = mapInstance;

    // Expose for testing
    if (typeof window !== "undefined") {
      (window as unknown as { __MAP_INSTANCE__: maplibregl.Map }).__MAP_INSTANCE__ = mapInstance;
    }

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
      // When overture sources are available, add hex layers below road layers
      // Otherwise, add them without a "before" reference
      const beforeLayer = pmtilesBase ? "game-roads-healthy-glow" : undefined;
      map.current?.addLayer(hexLayers.fill as maplibregl.AddLayerObject, beforeLayer);
      map.current?.addLayer(hexLayers.outline as maplibregl.AddLayerObject, beforeLayer);

      // Add crews source and layers
      map.current?.addSource("game-crews", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });

      // Load construction vehicle icon before adding crew layers
      loadConstructionVehicleIcon().then((img) => {
        if (!map.current?.hasImage("construction-vehicle")) {
          map.current?.addImage("construction-vehicle", img);
        }
      }).catch((err) => {
        console.warn("Failed to load construction vehicle icon:", err);
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
      // Add path line below crew icons
      map.current?.addLayer(crewPathLayers[0] as maplibregl.AddLayerObject, "game-crews-shadow");
      // Add shadow and icon on top
      for (let i = 1; i < crewPathLayers.length; i++) {
        map.current?.addLayer(crewPathLayers[i] as maplibregl.AddLayerObject);
      }

      // Add resource packages source and layers
      map.current?.addSource("game-resource-packages", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });

      for (const layer of getResourcePackageLayers()) {
        map.current?.addLayer(layer as maplibregl.AddLayerObject);
      }

      setIsLoaded(true);
      // Expose ready state for testing
      if (typeof window !== "undefined") {
        (window as unknown as { __MAP_READY__: boolean }).__MAP_READY__ = true;
      }
      map.current?.resize();
    });

    // Click handler
    mapInstance.on("click", (e) => {
      // Only query overture layers if sources are available
      const queryLayers = pmtilesBase
        ? [
          "game-roads-healthy", "game-roads-warning", "game-roads-degraded",
          "roads-low", "roads-mid", "roads-high", "roads-routes", "buildings"
        ]
        : [];
      const clickedFeatures = queryLayers.length > 0
        ? mapInstance.queryRenderedFeatures(e.point, { layers: queryLayers })
        : [];

      if (clickedFeatures && clickedFeatures.length > 0) {
        const feature = clickedFeatures[0];
        const gersId = feature.properties?.id;
        const type = feature.layer.id.includes("buildings") ? "building" : "road";

        if (pmtilesBase) {
          mapInstance.setFilter("game-feature-selection", ["==", ["get", "id"], gersId]);
          mapInstance.setFilter("game-feature-selection-glow", ["==", ["get", "id"], gersId]);
        }

        window.dispatchEvent(new CustomEvent("nightfall:feature_selected", {
          detail: { gers_id: gersId, type, position: { x: e.point.x, y: e.point.y } }
        }));
      } else {
        if (pmtilesBase) {
          mapInstance.setFilter("game-feature-selection", ["==", ["get", "id"], "none"]);
          mapInstance.setFilter("game-feature-selection-glow", ["==", ["get", "id"], "none"]);
        }
        window.dispatchEvent(new CustomEvent("nightfall:feature_selected", { detail: null }));
      }
    });

    // Hover handlers - only set up when overture layers are available
    if (pmtilesBase) {
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
    }

    return () => {
      mapInstance.remove();
      if (map.current === mapInstance) {
        map.current = null;
      }
      maplibregl.removeProtocol("pmtiles");
    };
  }, [fallbackBbox, focusH3Index, boundary, pmtilesBase]);

  // Tooltip handling
  useEffect(() => {
    if (!isLoaded || !map.current) return;

    const mapInstance = map.current;
    // Only include overture-dependent layers when sources are available
    const tooltipLayers = hasOvertureSources
      ? [
        "game-roads-healthy", "game-roads-warning", "game-roads-degraded",
        "roads-low", "roads-mid", "roads-high", "roads-routes",
        "buildings", "buildings-food", "buildings-equipment", "buildings-energy", "buildings-materials", "buildings-hub", "game-hex-fill"
      ]
      : ["game-hex-fill"];

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
        // Use Map lookup for O(1) instead of array.find() O(n)
        const match = gersId ? featuresByGersIdRef.current.get(gersId) : undefined;
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
        // Use Map lookups for O(1) instead of array.find() O(n)
        const match = featuresByGersIdRef.current.get(gersId);
        const taskMatch = tasksByGersIdRef.current.get(gersId);
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
  }, [isLoaded, isMobile, hasOvertureSources]);

  // Sync health data to vector tile features using pre-computed filter IDs
  useEffect(() => {
    if (!isLoaded || !map.current || !hasOvertureSources) return;

    const { healthyIds, degradedIds, foodIds, equipmentIds, energyIds, materialIds, hubIds } = featureFilterIds;
    const warningIds: string[] = []; // Warning state not used

    // Pre-compute filters to avoid repeated makeIdFilter calls
    const healthyFilter = makeIdFilter(healthyIds);
    const warningFilter = makeIdFilter(warningIds);
    const degradedFilter = makeIdFilter(degradedIds);

    map.current.setFilter("game-roads-healthy", ["all", BASE_ROAD_FILTER, healthyFilter] as maplibregl.FilterSpecification);
    map.current.setFilter("game-roads-healthy-glow", ["all", BASE_ROAD_FILTER, healthyFilter] as maplibregl.FilterSpecification);
    map.current.setFilter("game-roads-warning", ["all", BASE_ROAD_FILTER, warningFilter] as maplibregl.FilterSpecification);
    map.current.setFilter("game-roads-warning-glow", ["all", BASE_ROAD_FILTER, warningFilter] as maplibregl.FilterSpecification);
    map.current.setFilter("game-roads-degraded", ["all", BASE_ROAD_FILTER, degradedFilter] as maplibregl.FilterSpecification);
    map.current.setFilter("game-roads-degraded-glow", ["all", BASE_ROAD_FILTER, degradedFilter] as maplibregl.FilterSpecification);
    map.current.setFilter("buildings-food", makeIdFilter(foodIds) as maplibregl.FilterSpecification);
    map.current.setFilter("buildings-equipment", makeIdFilter(equipmentIds) as maplibregl.FilterSpecification);
    map.current.setFilter("buildings-energy", makeIdFilter(energyIds) as maplibregl.FilterSpecification);
    map.current.setFilter("buildings-materials", makeIdFilter(materialIds) as maplibregl.FilterSpecification);
    map.current.setFilter("buildings-hub", makeIdFilter(hubIds) as maplibregl.FilterSpecification);
    map.current.setFilter("buildings-hub-glow", makeIdFilter(hubIds) as maplibregl.FilterSpecification);
  }, [featureFilterIds, isLoaded, hasOvertureSources]);

  // Sync boosted building highlight layers
  useEffect(() => {
    if (!isLoaded || !map.current || !hasOvertureSources) return;

    const boostFilter = makeIdFilter(activeBoostedBuildingIds);
    map.current.setFilter("buildings-boost-glow", boostFilter as maplibregl.FilterSpecification);
    map.current.setFilter("buildings-boost-outline", boostFilter as maplibregl.FilterSpecification);
  }, [activeBoostedBuildingIds, isLoaded, hasOvertureSources]);

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

  // Build crew travel paths using server-provided waypoints when available
  useEffect(() => {
    if (!crews.length) {
      setCrewPaths([]);
      return;
    }

    const now = Date.now();
    const paths: CrewPath[] = [];

    for (const crew of crews) {
      if (crew.status !== "traveling") continue;

      // Use server-provided waypoints if available
      if (crew.waypoints && crew.waypoints.length > 0 && crew.path_started_at) {
        const path = crew.waypoints.map((wp) => wp.coord);
        const startTime = Date.parse(crew.path_started_at);
        const lastWaypoint = crew.waypoints[crew.waypoints.length - 1];
        const endTime = Date.parse(lastWaypoint.arrive_at);

        paths.push({
          crew_id: crew.crew_id,
          task_id: crew.active_task_id ?? "",
          path,
          startTime,
          endTime,
          status: "traveling",
          waypoints: crew.waypoints
        });
      } else if (crew.active_task_id) {
        // Fallback to client-side path building
        // Use Map lookups for O(1) instead of array.find() O(n)
        const task = tasksById.get(crew.active_task_id);
        if (!task?.target_gers_id) continue;

        const targetFeature = featuresByGersId.get(task.target_gers_id);
        const destination = targetFeature ? getFeatureCenter(targetFeature) : null;
        if (!destination) continue;

        // Use crew's current position as start if available, otherwise hub
        let start: [number, number];
        if (crew.current_lng != null && crew.current_lat != null) {
          start = [crew.current_lng, crew.current_lat];
        } else {
          start = getNearestHubCenter(features, destination) ?? fallbackCenter;
        }
        const path = buildResourcePath(start, destination, roadFeaturesForPath);

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
    }

    setCrewPaths(paths);
  }, [crews, tasksById, featuresByGersId, features, roadFeaturesForPath, fallbackCenter]);

  // Sync crews data - show idle and working crews at their positions
  useEffect(() => {
    if (!isLoaded || !map.current) return;

    const crewFeatures = crews
      .filter(crew => !travelingCrewIds.has(crew.crew_id))
      .map(crew => {
        let coords: [number, number] | null = null;

        // Use current position if available
        if (crew.current_lng != null && crew.current_lat != null) {
          coords = [crew.current_lng, crew.current_lat];
        } else if (crew.status === "working" && crew.active_task_id) {
          // Fallback: working crews at their task's road
          // Use Map lookups for O(1) instead of array.find() O(n)
          const task = tasksById.get(crew.active_task_id);
          if (task?.target_gers_id) {
            const feature = featuresByGersId.get(task.target_gers_id);
            if (feature) coords = getFeatureCenter(feature);
          }
        } else if (crew.status === "idle") {
          // Fallback: idle crews at nearest hub
          coords = getNearestHubCenter(features, fallbackCenter) ?? fallbackCenter;
        }

        if (!coords) return null;

        return {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: coords },
          properties: {
            crew_id: crew.crew_id,
            status: crew.status,
            active_task_id: crew.active_task_id
          }
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);

    const source = map.current.getSource("game-crews") as maplibregl.GeoJSONSource;
    if (source) {
      source.setData({ type: "FeatureCollection", features: crewFeatures });
    }
  }, [crews, tasksById, featuresByGersId, features, isLoaded, travelingCrewIds, fallbackCenter]);

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

    // Calculate bearing between two points (in degrees, 0 = north, 90 = east)
    const calculateBearing = (from: [number, number], to: [number, number]): number => {
      const dx = to[0] - from[0];
      const dy = to[1] - from[1];
      // atan2 returns radians, convert to degrees
      // Add 90 because atan2 treats 0 as pointing east, we want 0 = north
      const angleRad = Math.atan2(dx, dy);
      return (angleRad * 180) / Math.PI;
    };

    const updateMarkers = (now: number) => {
      const markerFeatures = crewPaths.map((cp) => {
        let position: [number, number];
        let bearing = 0;

        // Use waypoint-based interpolation if available
        if (cp.waypoints && cp.waypoints.length > 0) {
          const interpolated = interpolateWaypoints(cp.waypoints, now);
          if (interpolated) {
            position = interpolated;
            // Calculate bearing from slightly earlier position
            const prevInterpolated = interpolateWaypoints(cp.waypoints, now - 100);
            if (prevInterpolated && (prevInterpolated[0] !== position[0] || prevInterpolated[1] !== position[1])) {
              bearing = calculateBearing(prevInterpolated, position);
            }
          } else {
            // Animation complete, use last waypoint position
            position = cp.waypoints[cp.waypoints.length - 1].coord;
            // Calculate bearing from previous waypoint
            if (cp.waypoints.length >= 2) {
              bearing = calculateBearing(
                cp.waypoints[cp.waypoints.length - 2].coord,
                position
              );
            }
          }
        } else {
          // Fallback to uniform progress-based animation
          const duration = Math.max(1, cp.endTime - cp.startTime);
          const progress = Math.max(0, Math.min(1, (now - cp.startTime) / duration));
          position = interpolatePath(cp.path, progress) as [number, number];
          // Calculate bearing from path
          const prevProgress = Math.max(0, progress - 0.01);
          const prevPosition = interpolatePath(cp.path, prevProgress) as [number, number];
          if (prevPosition[0] !== position[0] || prevPosition[1] !== position[1]) {
            bearing = calculateBearing(prevPosition, position);
          }
        }

        return {
          type: "Feature" as const,
          properties: { crew_id: cp.crew_id, status: "traveling", bearing },
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

  // Fly to feature event handler
  useEffect(() => {
    const handleFlyToFeature = (e: Event) => {
      const customEvent = e as CustomEvent<{ gers_id: string }>;
      const gersId = customEvent.detail.gers_id;

      if (!map.current || !isLoaded) return;

      // Use Map lookup for O(1) instead of array.find() O(n)
      const feature = featuresByGersIdRef.current.get(gersId);
      if (!feature) return;

      const center = getFeatureCenter(feature);
      if (!center) return;

      map.current.flyTo({
        center,
        zoom: 16,
        pitch: 45,
        duration: 1500
      });

      // Also select the feature (only when overture layers are available)
      if (hasOvertureSources) {
        map.current.setFilter("game-feature-selection", ["==", ["get", "id"], gersId]);
        map.current.setFilter("game-feature-selection-glow", ["==", ["get", "id"], gersId]);
      }

      window.dispatchEvent(new CustomEvent("nightfall:feature_selected", {
        detail: { gers_id: gersId, type: "road" }
      }));
    };

    window.addEventListener("nightfall:fly_to_feature", handleFlyToFeature);
    return () => window.removeEventListener("nightfall:fly_to_feature", handleFlyToFeature);
  }, [isLoaded]);

  // Fly to convoy event handler
  useEffect(() => {
    const handleFlyToConvoy = (e: Event) => {
      const customEvent = e as CustomEvent<{ transfer_id: string }>;
      const transferId = customEvent.detail.transfer_id;

      if (!map.current || !isLoaded) return;

      // Find the convoy in resourcePackages
      const pkg = resourcePackagesRef.current.find(p => p.id === transferId);
      if (!pkg) return;

      // Get current position based on waypoints or path
      let position: [number, number] | null = null;
      const now = Date.now();

      if (pkg.waypoints && pkg.waypoints.length > 0) {
        position = interpolateWaypoints(pkg.waypoints, now);
      } else if (pkg.path && pkg.path.length > 0) {
        // Fallback: use the last position in the path
        const lastPoint = pkg.path[pkg.path.length - 1];
        position = [lastPoint[0], lastPoint[1]];
      }

      if (!position) return;

      map.current.flyTo({
        center: position,
        zoom: 17,
        pitch: 45,
        duration: 1200
      });
    };

    window.addEventListener("nightfall:fly_to_convoy", handleFlyToConvoy);
    return () => window.removeEventListener("nightfall:fly_to_convoy", handleFlyToConvoy);
  }, [isLoaded]);

  // Task completion animation
  useEffect(() => {
    const handleTaskCompleted = (e: Event) => {
      const customEvent = e as CustomEvent<{ gers_id: string }>;
      const gersId = customEvent.detail.gers_id;

      if (!map.current || !isLoaded || !hasOvertureSources) return;

      const baseFilter: maplibregl.FilterSpecification = ["all",
        ["==", ["get", "subtype"], "road"],
        ["==", ["get", "id"], gersId]
      ];

      map.current.setFilter("game-roads-completion-flash", baseFilter);
      map.current.setPaintProperty("game-roads-completion-flash", "line-opacity", 0.9);

      // Clear any existing interval before starting a new one (using ref to avoid closure issues)
      if (fadeIntervalRef.current) {
        clearInterval(fadeIntervalRef.current);
        fadeIntervalRef.current = null;
      }

      let opacity = 0.9;
      fadeIntervalRef.current = setInterval(() => {
        opacity -= 0.05;
        if (opacity <= 0 || !map.current) {
          if (fadeIntervalRef.current) {
            clearInterval(fadeIntervalRef.current);
            fadeIntervalRef.current = null;
          }
          map.current?.setFilter("game-roads-completion-flash", ["==", ["get", "id"], "none"]);
        } else {
          map.current?.setPaintProperty("game-roads-completion-flash", "line-opacity", opacity);
        }
      }, 50);
    };

    window.addEventListener("nightfall:task_completed", handleTaskCompleted);
    return () => {
      window.removeEventListener("nightfall:task_completed", handleTaskCompleted);
      // Clean up interval on unmount
      if (fadeIntervalRef.current) {
        clearInterval(fadeIntervalRef.current);
        fadeIntervalRef.current = null;
      }
    };
  }, [isLoaded, hasOvertureSources]);

  // Highlight queued/pending task roads
  useEffect(() => {
    if (!isLoaded || !map.current || !hasOvertureSources) return;

    const taskFilter: maplibregl.FilterSpecification = ["all",
      ["==", ["get", "subtype"], "road"],
      ["in", ["get", "id"], ["literal", queuedTaskRoadIds.length ? queuedTaskRoadIds : ["__none__"]]]
    ];

    map.current.setFilter("game-roads-task-highlight-glow", taskFilter);
    map.current.setFilter("game-roads-task-highlight-dash", taskFilter);
  }, [queuedTaskRoadIds, isLoaded, hasOvertureSources]);

  // Animate repair pulse
  useEffect(() => {
    if (!isLoaded || !map.current || !hasOvertureSources) return;

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
        const opacity = Math.max(0, 0.3 + 0.25 * Math.sin(pulsePhase));
        const width = Math.max(6, 12 + 6 * Math.sin(pulsePhase));
        map.current.setPaintProperty("game-roads-repair-pulse", "line-opacity", opacity);
        map.current.setPaintProperty("game-roads-repair-pulse", "line-width",
          ["interpolate", ["linear"], ["zoom"], 12, width, 16, width * 2]
        );
      });
    }

    return () => animationManager.stop('repair-pulse');
  }, [repairingRoadIds, isLoaded, animationManager, hasOvertureSources]);

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

    // Use Map lookups for O(1) instead of array.find() O(n)
    const sourceFeature = transfer.source_gers_id
      ? featuresByGersId.get(transfer.source_gers_id)
      : undefined;
    const hubFeature = transfer.hub_gers_id
      ? featuresByGersId.get(transfer.hub_gers_id)
      : undefined;

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
        waypoints: waypoints && waypoints.length > 0 ? waypoints : null,
        boostMultiplier: transfer.boost_multiplier ?? null
      }];
    });
  }, [featuresByGersId, features, fallbackCenter, isLoaded, roadFeaturesForPath]);

  // Listen for transfer events
  useEffect(() => {
    const handleTransfer = (e: Event) => {
      const customEvent = e as CustomEvent<ResourceTransferPayload>;
      spawnResourceTransfer(customEvent.detail);
    };

    window.addEventListener("nightfall:resource_transfer", handleTransfer);
    return () => window.removeEventListener("nightfall:resource_transfer", handleTransfer);
  }, [spawnResourceTransfer]);

  // Animate resource packages with throttled GeoJSON updates
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
    let frameCount = 0;
    const GEOJSON_UPDATE_INTERVAL = 2; // Update GeoJSON every N frames (reduces 60fps to 30fps for source updates)
    const TRAIL_SAMPLE_STEP = 0.05; // Coarser trail sampling (was 0.02 = 50 samples, now 20 samples)

    animationManager.start('resource-packages', () => {
      if (!mapInstance) return;

      frameCount++;
      const shouldUpdateSource = frameCount % GEOJSON_UPDATE_INTERVAL === 0;

      const now = Date.now();
      const activePackages: ResourcePackage[] = [];
      const geoFeatures: GeoJSON.Feature[] = [];

      for (const pkg of resourcePackages) {
        let position: [number, number] | null = null;
        let rawProgress: number;
        let finalPosition: [number, number] | null = null;

        // Use waypoint-based animation if available (server-provided with timestamps)
        if (pkg.waypoints && pkg.waypoints.length > 0) {
          // Calculate progress from waypoint timestamps
          const firstTime = Date.parse(pkg.waypoints[0].arrive_at);
          const lastTime = Date.parse(pkg.waypoints[pkg.waypoints.length - 1].arrive_at);
          rawProgress = Math.max(0, Math.min(1, (now - firstTime) / (lastTime - firstTime)));
          finalPosition = pkg.waypoints[pkg.waypoints.length - 1].coord;

          // Spawn particle when package first completes
          if (rawProgress >= 1 && !completedPackageIds.current.has(pkg.id)) {
            completedPackageIds.current.add(pkg.id);
            const screenPoint = mapInstance.project(finalPosition);
            const amount = Math.round(100 * (pkg.boostMultiplier ?? 1));
            setArrivalParticles(prev => [...prev, {
              id: pkg.id,
              x: screenPoint.x,
              y: screenPoint.y,
              amount,
              resourceType: pkg.type,
              createdAt: now
            }]);
          }

          // Remove completed packages after 2 second grace period for fade-out
          if (rawProgress >= 1 && now > lastTime + 2000) continue;

          position = interpolateWaypoints(pkg.waypoints, now);
          if (!position) continue;
        } else {
          // Fallback to uniform progress-based animation
          const elapsed = now - pkg.startTime;
          rawProgress = Math.max(0, Math.min(1, elapsed / pkg.duration));
          finalPosition = pkg.path[pkg.path.length - 1] as [number, number];

          // Spawn particle when package first completes
          if (rawProgress >= 1 && !completedPackageIds.current.has(pkg.id)) {
            completedPackageIds.current.add(pkg.id);
            const screenPoint = mapInstance.project(finalPosition);
            const amount = Math.round(100 * (pkg.boostMultiplier ?? 1));
            setArrivalParticles(prev => [...prev, {
              id: pkg.id,
              x: screenPoint.x,
              y: screenPoint.y,
              amount,
              resourceType: pkg.type,
              createdAt: now
            }]);
          }

          if (rawProgress >= 1) continue;

          const easedProgress = easeInOutCubic(rawProgress);
          position = interpolatePath(pkg.path, easedProgress) as [number, number];
        }

        // Calculate opacity for fade in/out
        let opacity = 1;
        if (rawProgress < 0.1) opacity = rawProgress / 0.1;
        else if (rawProgress > 0.9) opacity = (1 - rawProgress) / 0.1;

        // Build trail with coarser sampling for performance
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
          // For uniform animation, sample along the path with coarser step
          const easedProgress = easeInOutCubic(rawProgress);
          for (let t = 0; t <= easedProgress; t += TRAIL_SAMPLE_STEP) {
            trailCoords.push(interpolatePath(pkg.path, t) as [number, number]);
          }
        }

        const isBoosted = pkg.boostMultiplier != null && pkg.boostMultiplier > 1;

        if (trailCoords.length > 1) {
          geoFeatures.push({
            type: "Feature" as const,
            geometry: { type: "LineString" as const, coordinates: trailCoords },
            properties: { featureType: "trail", resourceType: pkg.type, boosted: isBoosted }
          });
        }

        geoFeatures.push({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: position },
          properties: { featureType: "package", resourceType: pkg.type, opacity, boosted: isBoosted }
        });

        activePackages.push({ ...pkg, progress: rawProgress });
      }

      // Only update GeoJSON source every N frames to reduce overhead
      if (shouldUpdateSource) {
        const source = mapInstance.getSource("game-resource-packages") as maplibregl.GeoJSONSource;
        if (source) source.setData({ type: "FeatureCollection", features: geoFeatures });
      }

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

  // Cleanup old arrival particles after animation completes
  useEffect(() => {
    if (arrivalParticles.length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setArrivalParticles(prev => prev.filter(p => now - p.createdAt < 1500));
      // Also clean up completed package IDs to prevent memory leak
      completedPackageIds.current.forEach(id => {
        if (!resourcePackages.some(pkg => pkg.id === id)) {
          completedPackageIds.current.delete(id);
        }
      });
    }, 500);
    return () => clearInterval(timer);
  }, [arrivalParticles.length, resourcePackages]);

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
        {/* Arrival particle text animations with screen reader support */}
        <div aria-live="polite" aria-atomic="false" className="sr-only">
          {arrivalParticles.slice(0, 1).map(particle => (
            <span key={particle.id}>
              Convoy arrived: {particle.amount} {particle.resourceType} delivered
            </span>
          ))}
        </div>
        {arrivalParticles.map(particle => {
          const color = RESOURCE_COLORS[particle.resourceType] || "#ffffff";

          return (
            <div
              key={particle.id}
              aria-hidden="true"
              className="pointer-events-none absolute z-40 font-bold text-sm whitespace-nowrap animate-[float-up_1.5s_ease-out_forwards]"
              style={{
                left: particle.x,
                top: particle.y,
                transform: "translate(-50%, -100%)",
                color,
                textShadow: `0 0 8px ${color}, 0 2px 4px rgba(0,0,0,0.5)`
              }}
            >
              +{particle.amount} {particle.resourceType}
            </div>
          );
        })}
        {children ? (
          <div className="pointer-events-none absolute inset-0 z-30">{children}</div>
        ) : null}
      </div>
    </div>
  );
}
