"use client";

import { useEffect, useState } from "react";
import { useStore } from "../store";

export default function PhaseIndicator() {
  const cycle = useStore((state) => state.cycle);
  const [secondsRemaining, setSecondsRemaining] = useState(cycle.next_phase_in_seconds);

  useEffect(() => {
    setSecondsRemaining(cycle.next_phase_in_seconds);
  }, [cycle.next_phase_in_seconds, cycle.phase]);

  useEffect(() => {
    if (secondsRemaining <= 0) return;

    const timer = setInterval(() => {
      setSecondsRemaining((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [secondsRemaining]);

  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const isNight = cycle.phase === "night" || cycle.phase === "dusk";

  return (
    <div className="flex items-center gap-4 rounded-full border border-[var(--night-outline)] bg-white/80 px-4 py-2 shadow-sm backdrop-blur-sm">
      <div className="relative h-8 w-8">
        {/* Progress Ring */}
        <svg className="h-full w-full -rotate-90">
          <circle
            cx="16"
            cy="16"
            r="14"
            fill="none"
            stroke="var(--night-outline)"
            strokeWidth="2"
          />
          <circle
            cx="16"
            cy="16"
            r="14"
            fill="none"
            stroke={isNight ? "var(--night-ink)" : "var(--night-glow)"}
            strokeWidth="2"
            strokeDasharray={88}
            strokeDashoffset={88 - (88 * cycle.phase_progress)}
            strokeLinecap="round"
            className="transition-all duration-1000"
          />
        </svg>
        
        {/* Icon */}
        <div className="absolute inset-0 flex items-center justify-center">
          {isNight ? (
            <svg className="h-4 w-4 text-[color:var(--night-ink)]" fill="currentColor" viewBox="0 0 20 20">
              <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
            </svg>
          ) : (
            <svg className="h-5 w-5 text-[color:var(--night-glow)]" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
            </svg>
          )}
        </div>
      </div>
      
      <div className="flex flex-col">
        <span className="text-[0.6rem] font-bold uppercase tracking-widest text-[color:var(--night-ash)] leading-none">
          {cycle.phase}
        </span>
        <span className="text-sm font-medium tabular-nums text-[color:var(--night-ink)]">
          {formatTime(secondsRemaining)}
        </span>
      </div>
    </div>
  );
}
