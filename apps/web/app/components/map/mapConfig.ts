import type { Phase } from "../../store";
import type maplibregl from "maplibre-gl";

// Crew status colors
export const CREW_COLORS = {
  idle: "#888888",
  traveling: "#f0ddc2",
  working: "#3eb0c0",
  returning: "#f08a4e"
} as const;

// Phase-based visual filters
export const PHASE_FILTERS: Record<Phase, string> = {
  dawn: "brightness(1.05) saturate(0.9) contrast(1.1)",
  day: "brightness(1.0) saturate(1.0) contrast(1.0)",
  dusk: "brightness(0.85) saturate(0.8) sepia(0.15) contrast(1.15)",
  night: "brightness(0.7) saturate(0.6) sepia(0.3) contrast(1.25)"
};

// Rust overlay opacity expressions
export const RUST_FILL_OPACITY_BASE: maplibregl.ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["get", "rust_level"],
  0, 0.08,
  0.5, 0.16,
  1, 0.26
];

export const RUST_LINE_OPACITY_BASE: maplibregl.ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["get", "rust_level"],
  0, 0.18,
  0.5, 0.32,
  1, 0.5
];

export const RUST_PHASE_MULTIPLIER: Record<Phase, number> = {
  night: 1.5,
  dusk: 1.2,
  dawn: 0.8,
  day: 0.6
};

// Crew dash animation sequence
export const CREW_DASH_SEQUENCE: number[][] = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0]
];

// Construction crew SVG icon - pickup truck badge
export const CONSTRUCTION_VEHICLE_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
  <!-- Badge background - dark circle with orange border -->
  <circle cx="20" cy="20" r="17" fill="#1a1a1a" fill-opacity="0.9"/>
  <circle cx="20" cy="20" r="17" fill="none" stroke="#FF9800" stroke-width="2.5"/>

  <!-- Pickup truck (side view, centered) -->
  <!-- Truck bed - flat bottom with raised sides -->
  <rect x="8" y="18" width="13" height="6" rx="1" fill="#FF9800"/>
  <!-- Bed sides/rails -->
  <rect x="8" y="16" width="2" height="2" fill="#FF9800"/>
  <rect x="19" y="16" width="2" height="2" fill="#FF9800"/>
  <!-- Cab -->
  <path d="M21 18 L21 24 L31 24 L31 19 L27 19 L25 14 L21 14 Z" fill="#FF9800"/>
  <!-- Windows -->
  <path d="M22 15 L24.5 15 L26 18 L22 18 Z" fill="#1a1a1a"/>
  <!-- Wheels -->
  <circle cx="12" cy="25" r="3" fill="#444"/>
  <circle cx="12" cy="25" r="1.5" fill="#666"/>
  <circle cx="27" cy="25" r="3" fill="#444"/>
  <circle cx="27" cy="25" r="1.5" fill="#666"/>
  <!-- Headlight -->
  <rect x="30" y="21" width="2" height="2" rx="0.5" fill="#FFD700"/>
</svg>
`;

// Create an ImageData-compatible array from SVG for MapLibre
export function createConstructionVehicleImage(): { width: number; height: number; data: Uint8ClampedArray } {
  const size = 40;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get canvas context");

  const img = new Image();
  const svgBlob = new Blob([CONSTRUCTION_VEHICLE_SVG], { type: "image/svg+xml" });
  const url = URL.createObjectURL(svgBlob);

  return new Promise((resolve) => {
    img.onload = () => {
      ctx.drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);
      const imageData = ctx.getImageData(0, 0, size, size);
      resolve({ width: size, height: size, data: imageData.data });
    };
    img.src = url;
  }) as unknown as { width: number; height: number; data: Uint8ClampedArray };
}

// Simpler approach: load icon as HTMLImageElement
export function loadConstructionVehicleIcon(): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image(40, 40);
    const svgBlob = new Blob([CONSTRUCTION_VEHICLE_SVG], { type: "image/svg+xml" });
    const url = URL.createObjectURL(svgBlob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

// Color palette - resource colors match ResourcePoolsPanel
export const COLORS = {
  background: "#0c0e12",
  landuse: "#181c24",
  water: "#0a1218",
  waterOutline: "#2a4560",
  buildings: "#1a1f28",
  buildingOutline: "#2a3040",
  // Resource building colors (matching RESOURCE_COLORS in ResourcePoolsPanel)
  buildingsFood: "#4ade80",       // green-400 - restaurants, cafes
  buildingsEquipment: "#f97316",  // orange-500 - hardware, auto
  buildingsEnergy: "#facc15",     // yellow-400 - industrial, power
  buildingsMaterials: "#818cf8",  // indigo-400 - construction, lumber
  roadsLow: "#252530",
  roadsMid: "#2a3040",
  roadsHigh: "#353a4a",
  roadsRoute: "#2a3545",
  healthy: "#3eb0c0",
  warning: "#f08a4e",
  degraded: "#e03a30",
  selection: "#ffffff"
} as const;

// Resource type to color mapping for convoy animations
export const RESOURCE_COLORS: Record<string, string> = {
  food: COLORS.buildingsFood,
  equipment: COLORS.buildingsEquipment,
  energy: COLORS.buildingsEnergy,
  materials: COLORS.buildingsMaterials
} as const;

// Get transition gradient based on phase
export function getTransitionGradient(currentPhase: Phase, nextPhase: Phase): string {
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
}
