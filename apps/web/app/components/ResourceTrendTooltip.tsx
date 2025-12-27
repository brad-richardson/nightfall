"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Sparkline } from "./Sparkline";
import {
  getResourceHistory,
  getResourceTrend,
  type ResourceType,
  type HistoryPoint
} from "../lib/resourceHistory";
import { formatNumber } from "../lib/formatters";

type ResourceTrendTooltipProps = {
  resourceType: ResourceType;
  color: string;
  isVisible: boolean;
  isLight: boolean;
  anchorRect?: DOMRect | null;
};

/**
 * Tooltip showing resource history trendline and statistics.
 * Appears on hover (desktop) or tap (mobile).
 */
export function ResourceTrendTooltip({
  resourceType,
  color,
  isVisible,
  isLight,
  anchorRect
}: ResourceTrendTooltipProps) {
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [trend, setTrend] = useState(getResourceTrend(resourceType));
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  // Refresh history data when visible
  useEffect(() => {
    if (!isVisible) return;

    const update = () => {
      setHistory(getResourceHistory(resourceType));
      setTrend(getResourceTrend(resourceType));
    };

    update();
    // Update at same interval as data recording (5 seconds)
    const interval = setInterval(update, 5000);
    return () => clearInterval(interval);
  }, [isVisible, resourceType]);

  // Position the tooltip relative to anchor
  // Re-calculate when history changes as it affects tooltip size
  const historyLength = history.length;
  useEffect(() => {
    if (!isVisible || !anchorRect || !tooltipRef.current) return;

    const tooltip = tooltipRef.current;
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Default: position above the anchor, centered
    let top = anchorRect.top - tooltipRect.height - 8;
    let left = anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2;

    // If not enough space above, position below
    if (top < 8) {
      top = anchorRect.bottom + 8;
    }

    // Keep within horizontal bounds
    if (left < 8) {
      left = 8;
    } else if (left + tooltipRect.width > viewportWidth - 8) {
      left = viewportWidth - tooltipRect.width - 8;
    }

    // Keep within vertical bounds
    if (top + tooltipRect.height > viewportHeight - 8) {
      top = viewportHeight - tooltipRect.height - 8;
    }

    setPosition({ top, left });
  }, [isVisible, anchorRect, historyLength]);

  if (!isVisible) return null;

  const values = history.map((p) => p.value);
  const hasData = history.length >= 2;
  const trendIcon =
    trend.trend === "up" ? "↑" : trend.trend === "down" ? "↓" : "→";
  const trendColorClass =
    trend.trend === "up"
      ? "text-green-400"
      : trend.trend === "down"
        ? "text-red-400"
        : "text-white/50";

  const resourceLabel =
    resourceType.charAt(0).toUpperCase() + resourceType.slice(1);

  return (
    <div
      ref={tooltipRef}
      className={`fixed z-[100] rounded-xl border p-3 shadow-xl backdrop-blur-md transition-all duration-200 ${
        isLight
          ? "border-black/10 bg-white/95 text-[color:var(--night-ink)]"
          : "border-white/10 bg-[#0f1216]/95 text-white"
      }`}
      style={{
        top: position.top,
        left: position.left,
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? "translateY(0)" : "translateY(4px)"
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="text-xs font-semibold">{resourceLabel} Trend</span>
        {hasData && (
          <span className={`text-xs font-bold ${trendColorClass}`}>
            {trendIcon} {trend.change > 0 ? "+" : ""}
            {formatNumber(Math.round(trend.change))}
          </span>
        )}
      </div>

      <div className="mt-2">
        <Sparkline
          data={values}
          width={140}
          height={40}
          color={color}
          showArea={true}
        />
      </div>

      {hasData ? (
        <div
          className={`mt-2 grid grid-cols-3 gap-2 text-center text-[10px] ${
            isLight ? "text-[color:var(--night-ash)]" : "text-white/50"
          }`}
        >
          <div>
            <div className="font-semibold">{formatNumber(trend.min)}</div>
            <div>Min</div>
          </div>
          <div>
            <div className="font-semibold">{formatNumber(trend.current)}</div>
            <div>Now</div>
          </div>
          <div>
            <div className="font-semibold">{formatNumber(trend.max)}</div>
            <div>Max</div>
          </div>
        </div>
      ) : (
        <div
          className={`mt-2 text-center text-[10px] ${
            isLight ? "text-[color:var(--night-ash)]" : "text-white/40"
          }`}
        >
          Collecting data...
        </div>
      )}

      <div
        className={`mt-2 text-center text-[9px] ${
          isLight ? "text-[color:var(--night-ash)]/60" : "text-white/30"
        }`}
      >
        Last {Math.min(history.length, 120)} samples
      </div>
    </div>
  );
}

/**
 * Hook to manage tooltip visibility with hover and touch support
 */
export function useResourceTooltip() {
  const [activeResource, setActiveResource] = useState<ResourceType | null>(
    null
  );
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showTooltip = useCallback(
    (type: ResourceType, element: HTMLElement) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setAnchorRect(element.getBoundingClientRect());
      setActiveResource(type);
    },
    []
  );

  const hideTooltip = useCallback(() => {
    // Small delay to allow moving to tooltip
    timeoutRef.current = setTimeout(() => {
      setActiveResource(null);
      setAnchorRect(null);
    }, 150);
  }, []);

  const hideTooltipImmediate = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setActiveResource(null);
    setAnchorRect(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return {
    activeResource,
    anchorRect,
    showTooltip,
    hideTooltip,
    hideTooltipImmediate
  };
}
