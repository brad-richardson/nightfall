"use client";

import { useState, useId } from "react";

type ConnectionStatusProps = {
  isMapDataUnavailable: boolean;
};

export function ConnectionStatus({ isMapDataUnavailable }: ConnectionStatusProps) {
  const [showDetails, setShowDetails] = useState(false);
  const tooltipId = useId();

  if (!isMapDataUnavailable) return null;

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setShowDetails(!showDetails)}
        onMouseEnter={() => setShowDetails(true)}
        onMouseLeave={() => setShowDetails(false)}
        onFocus={() => setShowDetails(true)}
        onBlur={() => setShowDetails(false)}
        className="ml-3 inline-flex items-center gap-1.5 rounded bg-amber-900/50 px-2 py-0.5 text-[0.65rem] font-bold text-amber-200 transition-colors hover:bg-amber-900/70 focus:outline-none focus:ring-2 focus:ring-amber-400/50"
        aria-describedby={showDetails ? tooltipId : undefined}
        aria-expanded={showDetails}
      >
        <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" aria-hidden="true" />
        OFFLINE
      </button>

      {showDetails && (
        <div
          id={tooltipId}
          role="tooltip"
          className="absolute left-0 top-full z-50 mt-2 w-64 rounded-xl border border-white/10 bg-[#0f1216]/95 p-3 text-left shadow-[0_8px_24px_rgba(0,0,0,0.5)] backdrop-blur-md"
        >
          <p className="text-[10px] uppercase tracking-[0.2em] text-amber-400/80">
            Disconnected from Mainframe
          </p>
          <p className="mt-2 text-xs leading-relaxed text-white/70">
            Map background tiles are temporarily unavailable. Game data is still updating normally.
          </p>
          <p className="mt-2 text-[10px] text-white/40">
            Reconnecting automatically...
          </p>
        </div>
      )}
    </div>
  );
}
