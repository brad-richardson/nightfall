import type { CSSProperties, ReactNode } from "react";

type Position = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "bottom-center";

interface MapOverlayProps {
  position: Position;
  children: ReactNode;
  className?: string;
  mobileHidden?: boolean;
  style?: CSSProperties;
}

/**
 * Wrapper component for positioning UI overlays on top of the map.
 * Provides consistent positioning and responsive behavior.
 */
export function MapOverlay({ position, children, className = "", mobileHidden = false, style }: MapOverlayProps) {
  const positionClasses: Record<Position, string> = {
    "top-left": "top-4 left-4",
    "top-right": "top-4 right-4",
    "bottom-left": "bottom-4 left-4",
    "bottom-right": "bottom-4 right-4",
    "bottom-center": "bottom-4 left-1/2 -translate-x-1/2"
  };

  const mobileClass = mobileHidden ? "hidden md:block" : "";

  return (
    <div className={`pointer-events-auto absolute ${positionClasses[position]} ${mobileClass} ${className}`} style={style}>
      {children}
    </div>
  );
}
