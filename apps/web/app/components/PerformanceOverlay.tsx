"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { setAnimationTrackingCallbacks } from "../lib/animationManager";

// Global performance tracking
const perfStats = {
  batchFires: 0,
  batchWithUpdates: 0,
  animations: new Set<string>(),
  itemCounts: { packages: 0, crews: 0 },
  resetCounters: () => {
    perfStats.batchFires = 0;
    perfStats.batchWithUpdates = 0;
  }
};

// Export for instrumentation in other components
export function trackBatchFire(hadUpdates: boolean) {
  perfStats.batchFires++;
  if (hadUpdates) perfStats.batchWithUpdates++;
}

// Track animated item counts (called from DemoMap)
export function trackAnimatedItems(packages: number, crews: number) {
  perfStats.itemCounts.packages = packages;
  perfStats.itemCounts.crews = crews;
}

// Connect to animation manager
setAnimationTrackingCallbacks(
  (id) => perfStats.animations.add(id),
  (id) => perfStats.animations.delete(id)
);

export function PerformanceOverlay() {
  const [visible, setVisible] = useState(false);
  const [fps, setFps] = useState(0);
  const [stats, setStats] = useState({ batchFires: 0, batchWithUpdates: 0, animations: 0, packages: 0, crews: 0 });

  const frameTimesRef = useRef<number[]>([]);
  const lastFrameTimeRef = useRef(performance.now());
  const rafIdRef = useRef<number | null>(null);

  // FPS calculation loop
  const measureFrame = useCallback(() => {
    const now = performance.now();
    const delta = now - lastFrameTimeRef.current;
    lastFrameTimeRef.current = now;

    // Keep last 60 frame times for averaging
    frameTimesRef.current.push(delta);
    if (frameTimesRef.current.length > 60) {
      frameTimesRef.current.shift();
    }

    // Calculate average FPS
    const avgDelta = frameTimesRef.current.reduce((a, b) => a + b, 0) / frameTimesRef.current.length;
    const currentFps = Math.round(1000 / avgDelta);

    // Update stats every 500ms to reduce overhead
    if (frameTimesRef.current.length % 30 === 0) {
      setFps(currentFps);
      setStats({
        batchFires: perfStats.batchFires,
        batchWithUpdates: perfStats.batchWithUpdates,
        animations: perfStats.animations.size,
        packages: perfStats.itemCounts.packages,
        crews: perfStats.itemCounts.crews
      });
    }

    rafIdRef.current = requestAnimationFrame(measureFrame);
  }, []);

  // Start/stop measurement based on visibility
  useEffect(() => {
    if (visible) {
      perfStats.resetCounters();
      lastFrameTimeRef.current = performance.now();
      frameTimesRef.current = [];
      rafIdRef.current = requestAnimationFrame(measureFrame);

      // Reset counters every second for rate calculation
      const interval = setInterval(() => {
        perfStats.resetCounters();
      }, 1000);

      return () => {
        if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
        clearInterval(interval);
      };
    }
  }, [visible, measureFrame]);

  // Keyboard shortcut: Ctrl+Shift+P
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "P") {
        e.preventDefault();
        setVisible((v) => !v);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Only render in development
  if (process.env.NODE_ENV !== "development") return null;
  if (!visible) return null;

  const fpsColor = fps >= 55 ? "#4ade80" : fps >= 30 ? "#facc15" : "#ef4444";

  return (
    <div className="fixed bottom-16 left-4 z-[9999] rounded-lg border border-white/20 bg-black/80 p-3 font-mono text-xs text-white backdrop-blur-sm lg:bottom-4">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-white/50">
        Performance (Ctrl+Shift+P)
      </div>
      <div className="space-y-1">
        <div className="flex justify-between gap-4">
          <span className="text-white/60">FPS</span>
          <span style={{ color: fpsColor }}>{fps}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-white/60">RAF loops</span>
          <span>{stats.animations}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-white/60">Packages</span>
          <span>{stats.packages} in transit</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-white/60">Crews</span>
          <span>{stats.crews} traveling</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-white/60">Batch/sec</span>
          <span>
            {stats.batchFires}
            {stats.batchWithUpdates > 0 && (
              <span className="text-white/40"> ({stats.batchWithUpdates} w/data)</span>
            )}
          </span>
        </div>
      </div>
      <div className="mt-2 text-[9px] text-white/30">
        Loops: {Array.from(perfStats.animations).join(", ") || "none"}
      </div>
    </div>
  );
}
