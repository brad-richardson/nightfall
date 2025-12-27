import type { Feature, Geometry, LineString, Point as GeoJSONPoint } from "geojson";

/**
 * Type-safe GeoJSON feature properties for roads
 */
export interface RoadFeatureProperties {
  gers_id: string;
  road_class: string;
  health: number;
  status?: string | null;
}

/**
 * Type-safe GeoJSON feature properties for buildings
 */
export interface BuildingFeatureProperties {
  gers_id: string;
  place_category: string;
  generates_food: boolean;
  generates_equipment: boolean;
  generates_energy: boolean;
  generates_materials: boolean;
  is_hub: boolean;
}

/**
 * Type-safe GeoJSON feature properties for hex cells
 */
export interface HexFeatureProperties {
  h3_index: string;
  rust_level: number;
}

/**
 * Type-safe GeoJSON feature for roads
 */
export type RoadFeature = Feature<LineString, RoadFeatureProperties>;

/**
 * Type-safe GeoJSON feature for buildings
 */
export type BuildingFeature = Feature<GeoJSONPoint, BuildingFeatureProperties>;

/**
 * Type-safe GeoJSON feature for hex cells
 */
export type HexFeature = Feature<Geometry, HexFeatureProperties>;

/**
 * Union type for all game features
 */
export type GameFeature = RoadFeature | BuildingFeature | HexFeature;

/**
 * Type guard to check if feature is a road
 */
export function isRoadFeature(feature: GameFeature): feature is RoadFeature {
  return "road_class" in feature.properties;
}

/**
 * Type guard to check if feature is a building
 */
export function isBuildingFeature(feature: GameFeature): feature is BuildingFeature {
  return "place_category" in feature.properties;
}

/**
 * Type guard to check if feature is a hex
 */
export function isHexFeature(feature: GameFeature): feature is HexFeature {
  return "h3_index" in feature.properties;
}

/**
 * Crew path line feature
 */
export interface CrewPathProperties {
  crew_id: string;
}

export type CrewPathFeature = Feature<LineString, CrewPathProperties>;

/**
 * Crew marker point feature
 */
export interface CrewMarkerProperties {
  crew_id: string;
}

export type CrewMarkerFeature = Feature<GeoJSONPoint, CrewMarkerProperties>;
