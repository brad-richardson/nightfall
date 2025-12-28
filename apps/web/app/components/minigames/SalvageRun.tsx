"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { MinigameDifficulty } from "../../store";

type SalvageRunProps = {
  config: {
    base_rounds: number;
    max_score: number;
    expected_duration_ms: number;
  };
  difficulty: MinigameDifficulty;
  onComplete: (score: number) => void;
};

type GamePhase = "ready" | "scanning" | "result" | "complete";

// Zone accuracy thresholds (distance from center of clean zone as % of zone width)
const PERFECT_THRESHOLD = 0.2; // Within 20% of center = perfect
const GREAT_THRESHOLD = 0.5; // Within 50% = great
const GOOD_THRESHOLD = 0.8; // Within 80% = good

export default function SalvageRun({ config, difficulty, onComplete }: SalvageRunProps) {
  const [phase, setPhase] = useState<GamePhase>("ready");
  const [countdown, setCountdown] = useState(3);
  const [markerPosition, setMarkerPosition] = useState(0); // 0 to 100
  const [markerDirection, setMarkerDirection] = useState(1);
  const [roundsCompleted, setRoundsCompleted] = useState(0);
  const [score, setScore] = useState(0);
  const [lastResult, setLastResult] = useState<{ zone: string; points: number; color: string } | null>(null);
  const [cleanZone, setCleanZone] = useState({ start: 40, width: 20 }); // Clean zone position and width

  const animationRef = useRef<number>();
  const lastTimeRef = useRef<number>(0);
  const scoreRef = useRef(score);
  scoreRef.current = score;

  // Speed increases with difficulty
  const baseSpeed = 100; // % per second at speed_mult = 1
  const speed = baseSpeed * difficulty.speed_mult;

  // Total rounds needed
  const roundsNeeded = config.base_rounds + difficulty.extra_rounds;

  // Clean zone width shrinks with difficulty
  const baseZoneWidth = 25;
  const zoneWidth = Math.max(12, baseZoneWidth - difficulty.rust_level * 10);

  // Generate new clean zone position
  const generateCleanZone = useCallback(() => {
    // Random position, keeping zone fully within bounds
    const minStart = 5;
    const maxStart = 95 - zoneWidth;
    const start = minStart + Math.random() * (maxStart - minStart);
    setCleanZone({ start, width: zoneWidth });
  }, [zoneWidth]);

  // Calculate points based on marker position relative to clean zone
  const getZonePoints = useCallback((position: number) => {
    const zoneCenter = cleanZone.start + cleanZone.width / 2;
    const distanceFromCenter = Math.abs(position - zoneCenter);
    const normalizedDistance = distanceFromCenter / (cleanZone.width / 2);
    const roundPoints = Math.round(config.max_score / roundsNeeded);

    if (normalizedDistance <= PERFECT_THRESHOLD) {
      return { zone: "PERFECT!", points: roundPoints, color: "#a78bfa" };
    } else if (normalizedDistance <= GREAT_THRESHOLD) {
      return { zone: "GREAT!", points: Math.round(roundPoints * 0.75), color: "#4ade80" };
    } else if (normalizedDistance <= GOOD_THRESHOLD) {
      return { zone: "GOOD", points: Math.round(roundPoints * 0.5), color: "#60a5fa" };
    } else if (position >= cleanZone.start && position <= cleanZone.start + cleanZone.width) {
      return { zone: "OK", points: Math.round(roundPoints * 0.25), color: "#94a3b8" };
    } else {
      return { zone: "MISS", points: 0, color: "#ef4444" };
    }
  }, [cleanZone, config.max_score, roundsNeeded]);

  // Animation loop for marker movement
  useEffect(() => {
    if (phase !== "scanning") {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      return;
    }

    const animate = (time: number) => {
      if (lastTimeRef.current === 0) {
        lastTimeRef.current = time;
      }

      const delta = (time - lastTimeRef.current) / 1000;
      lastTimeRef.current = time;

      setMarkerPosition((prev) => {
        let next = prev + markerDirection * speed * delta;

        // Bounce at edges
        if (next > 100) {
          next = 100 - (next - 100);
          setMarkerDirection(-1);
        } else if (next < 0) {
          next = -(next);
          setMarkerDirection(1);
        }

        return Math.max(0, Math.min(100, next));
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    lastTimeRef.current = 0;
    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [phase, markerDirection, speed]);

  // Countdown before game starts
  useEffect(() => {
    if (phase !== "ready") return;

    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      // Start the game
      generateCleanZone();
      setPhase("scanning");
      setMarkerPosition(0);
      setMarkerDirection(1);
    }
  }, [countdown, phase, generateCleanZone]);

  const handleGrab = useCallback(() => {
    if (phase !== "scanning") return;

    const result = getZonePoints(markerPosition);
    setLastResult(result);
    setScore((s) => s + result.points);
    setRoundsCompleted((c) => c + 1);
    setPhase("result");

    // After showing result, either continue or complete
    setTimeout(() => {
      if (roundsCompleted + 1 >= roundsNeeded) {
        setPhase("complete");
        onComplete(scoreRef.current + result.points);
      } else {
        // Generate new clean zone for next round
        generateCleanZone();
        // Reset marker
        setMarkerPosition(Math.random() * 100);
        setMarkerDirection(Math.random() > 0.5 ? 1 : -1);
        setLastResult(null);
        setPhase("scanning");
      }
    }, 500);
  }, [phase, markerPosition, roundsCompleted, roundsNeeded, getZonePoints, generateCleanZone, onComplete]);

  // Handle keyboard/touch
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        handleGrab();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleGrab]);

  // Render countdown
  if (phase === "ready") {
    return (
      <div className="flex flex-col items-center justify-center">
        <p className="mb-4 text-lg text-white/60">Grab salvage in the clean zone!</p>
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[#a78bfa]/20 text-5xl font-bold text-[#a78bfa]">
          {countdown}
        </div>
        <p className="mt-4 text-sm text-white/40">Get ready...</p>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-md flex-col items-center">
      {/* Status bar */}
      <div className="mb-6 flex w-full items-center justify-between text-sm">
        <div className="text-white/60">
          Salvage <span className="font-bold text-white">{roundsCompleted + 1}</span> / {roundsNeeded}
        </div>
        <div className="text-white/60">
          Score: <span className="font-bold text-[#a78bfa]">{score}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-8 h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full bg-gradient-to-r from-[#a78bfa] to-[#818cf8] transition-all duration-300"
          style={{ width: `${(roundsCompleted / roundsNeeded) * 100}%` }}
        />
      </div>

      {/* Salvage scanner visualization */}
      <div className="relative mb-8 w-full">
        {/* Salvage icon */}
        <div className="mb-4 flex justify-center">
          <span className="text-6xl">📦</span>
        </div>

        {/* Scanner track */}
        <div className="relative h-16 w-full overflow-hidden rounded-2xl bg-gradient-to-r from-[#ef4444]/30 via-[#64748b]/30 to-[#ef4444]/30">
          {/* Contaminated zone overlay (everywhere except clean zone) */}
          <div className="absolute inset-0 bg-[#ef4444]/20" />

          {/* Clean zone */}
          <div
            className="absolute top-0 h-full bg-gradient-to-b from-[#4ade80]/40 to-[#4ade80]/20 transition-all duration-300"
            style={{
              left: `${cleanZone.start}%`,
              width: `${cleanZone.width}%`,
            }}
          >
            {/* Perfect zone (center) */}
            <div
              className="absolute top-0 h-full bg-[#a78bfa]/40"
              style={{
                left: `${50 - (PERFECT_THRESHOLD * 100) / 2}%`,
                width: `${PERFECT_THRESHOLD * 100}%`,
              }}
            />
          </div>

          {/* Zone labels */}
          <div
            className="absolute top-1 text-[10px] font-bold uppercase tracking-wide text-[#4ade80]"
            style={{
              left: `${cleanZone.start + cleanZone.width / 2}%`,
              transform: "translateX(-50%)",
            }}
          >
            CLEAN
          </div>

          {/* Moving scanner/grabber indicator */}
          <div
            className="absolute top-1 h-14 w-4 -translate-x-1/2 transition-none"
            style={{ left: `${markerPosition}%` }}
          >
            {/* Grabber arm */}
            <div className="h-full w-1 mx-auto rounded-full bg-white shadow-[0_0_15px_rgba(255,255,255,0.8)]" />
            {/* Grabber claw */}
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-lg">
              🦾
            </div>
          </div>
        </div>

        {/* Track labels */}
        <div className="mt-2 flex justify-between text-xs text-white/40">
          <span className="text-red-400">CONTAMINATED</span>
          <span className="text-green-400">SALVAGEABLE</span>
          <span className="text-red-400">CONTAMINATED</span>
        </div>
      </div>

      {/* Phase indicator */}
      <div className="mb-6 h-12 text-center">
        {phase === "scanning" && (
          <p className="animate-pulse text-lg font-medium text-[#a78bfa]">
            Tap to grab salvage!
          </p>
        )}
        {phase === "result" && lastResult && (
          <div className="flex flex-col items-center">
            <p
              className="text-2xl font-bold"
              style={{ color: lastResult.color }}
            >
              {lastResult.zone}
            </p>
            <p className="text-sm text-white/60">+{lastResult.points} points</p>
          </div>
        )}
        {phase === "complete" && (
          <p className="text-xl font-bold text-[#4ade80]">
            Salvage Complete!
          </p>
        )}
      </div>

      {/* Tap area button */}
      <button
        onClick={handleGrab}
        disabled={phase !== "scanning"}
        className={`flex h-24 w-24 items-center justify-center rounded-full border-4 text-4xl transition-all ${
          phase === "scanning"
            ? "border-[#a78bfa] bg-[#a78bfa]/20 hover:bg-[#a78bfa]/30 active:scale-95"
            : "border-white/20 bg-white/5"
        }`}
      >
        📦
      </button>

      {/* Difficulty indicators */}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs text-white/40">
        {difficulty.phase === "night" && (
          <div className="flex items-center gap-1">
            <span className="text-purple-400">🌙</span>
            <span>Night mode: Faster scanner</span>
          </div>
        )}
        {difficulty.rust_level > 0.5 && (
          <div className="flex items-center gap-1">
            <span className="text-orange-400">🔥</span>
            <span>High rust: Smaller clean zones</span>
          </div>
        )}
      </div>
    </div>
  );
}
