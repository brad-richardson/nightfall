"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { MinigameDifficulty } from "../../store";

type PowerUpProps = {
  config: {
    base_rounds: number;
    max_score: number;
    expected_duration_ms: number;
  };
  difficulty: MinigameDifficulty;
  onComplete: (score: number) => void;
};

type GamePhase = "ready" | "charging" | "result" | "complete";

// Zone thresholds (as % from center)
const PERFECT_ZONE = 5; // Within 5% of center = perfect
const GREAT_ZONE = 15; // Within 15% = great
const GOOD_ZONE = 30; // Within 30% = good

export default function PowerUp({ config, difficulty, onComplete }: PowerUpProps) {
  const [phase, setPhase] = useState<GamePhase>("ready");
  const [countdown, setCountdown] = useState(3);
  const [meterPosition, setMeterPosition] = useState(0); // -100 to 100
  const [meterDirection, setMeterDirection] = useState(1);
  const [chargesCompleted, setChargesCompleted] = useState(0);
  const [score, setScore] = useState(0);
  const [lastResult, setLastResult] = useState<{ zone: string; points: number; color: string } | null>(null);
  const [targetZoneSize, setTargetZoneSize] = useState(30); // Starting zone size

  const animationRef = useRef<number>();
  const lastTimeRef = useRef<number>(0);
  // Use ref to avoid stale closure in setTimeout callback
  const scoreRef = useRef(score);
  scoreRef.current = score;

  // Speed increases with difficulty
  const baseSpeed = 180; // degrees per second at speed_mult = 1
  const speed = baseSpeed * difficulty.speed_mult;

  // Total charges needed: use config.base_rounds (server-provided), add extra for night mode
  const chargesNeeded = config.base_rounds + difficulty.extra_rounds;

  // Points per zone - memoized to avoid recreation on every render
  const getZonePoints = useCallback((position: number) => {
    const absPos = Math.abs(position);
    const chargePoints = Math.round(config.max_score / chargesNeeded);

    if (absPos <= PERFECT_ZONE) {
      return { zone: "PERFECT!", points: chargePoints, color: "#fbbf24" };
    } else if (absPos <= GREAT_ZONE) {
      return { zone: "GREAT!", points: Math.round(chargePoints * 0.75), color: "#4ade80" };
    } else if (absPos <= GOOD_ZONE) {
      return { zone: "GOOD", points: Math.round(chargePoints * 0.5), color: "#60a5fa" };
    } else if (absPos <= 50) {
      return { zone: "OK", points: Math.round(chargePoints * 0.25), color: "#94a3b8" };
    } else {
      return { zone: "MISS", points: 0, color: "#ef4444" };
    }
  }, [config.max_score, chargesNeeded]);

  // Animation loop for meter movement
  useEffect(() => {
    if (phase !== "charging") {
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

      setMeterPosition((prev) => {
        let next = prev + meterDirection * speed * delta;

        // Bounce at edges with clamping to handle large delta overshoots
        if (next > 100) {
          next = 100 - (next - 100);
          setMeterDirection(-1);
        } else if (next < -100) {
          next = -100 - (next + 100);
          setMeterDirection(1);
        }

        // Clamp to ensure we stay within bounds even with extreme overshoots
        return Math.max(-100, Math.min(100, next));
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
  }, [phase, meterDirection, speed]);

  // Countdown before game starts
  useEffect(() => {
    if (phase !== "ready") return;

    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      // Start the game
      setPhase("charging");
      setMeterPosition(-100);
      setMeterDirection(1);
    }
  }, [countdown, phase]);

  const handleTap = useCallback(() => {
    if (phase !== "charging") return;

    const result = getZonePoints(meterPosition);
    setLastResult(result);
    setScore((s) => s + result.points);
    setChargesCompleted((c) => c + 1);
    setPhase("result");

    // After showing result, either continue or complete
    setTimeout(() => {
      if (chargesCompleted + 1 >= chargesNeeded) {
        setPhase("complete");
        // Use ref to get current score value (avoids stale closure)
        onComplete(scoreRef.current + result.points);
      } else {
        // Shrink target zone slightly each round (make it harder)
        setTargetZoneSize((prev) => Math.max(15, prev - 2));
        // Reset for next charge
        setMeterPosition(-100);
        setMeterDirection(1);
        setLastResult(null);
        setPhase("charging");
      }
    }, 600);
  }, [phase, meterPosition, chargesCompleted, chargesNeeded, getZonePoints, onComplete]);

  // Handle keyboard/touch
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        handleTap();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleTap]);

  // Render countdown
  if (phase === "ready") {
    return (
      <div className="flex flex-col items-center justify-center">
        <p className="mb-4 text-lg text-white/60">Stop in the zone!</p>
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[#facc15]/20 text-5xl font-bold text-[#facc15]">
          {countdown}
        </div>
        <p className="mt-4 text-sm text-white/40">Get ready...</p>
      </div>
    );
  }

  const meterPercent = (meterPosition + 100) / 2; // Convert -100..100 to 0..100

  return (
    <div className="flex w-full max-w-md flex-col items-center">
      {/* Status bar */}
      <div className="mb-6 flex w-full items-center justify-between text-sm">
        <div className="text-white/60">
          Charge <span className="font-bold text-white">{chargesCompleted + 1}</span> / {chargesNeeded}
        </div>
        <div className="text-white/60">
          Score: <span className="font-bold text-[#facc15]">{score}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-8 h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full bg-gradient-to-r from-[#facc15] to-[#f97316] transition-all duration-300"
          style={{ width: `${(chargesCompleted / chargesNeeded) * 100}%` }}
        />
      </div>

      {/* Power meter visualization */}
      <div className="relative mb-8 w-full">
        {/* Lightning bolt icon */}
        <div className="mb-4 flex justify-center">
          <span className="text-6xl">⚡</span>
        </div>

        {/* Meter track */}
        <div className="relative h-16 w-full overflow-hidden rounded-2xl bg-gradient-to-r from-[#ef4444] via-[#4ade80] to-[#ef4444]">
          {/* Target zone indicator (center) */}
          <div
            className="absolute top-0 h-full bg-white/30"
            style={{
              left: `${50 - targetZoneSize / 2}%`,
              width: `${targetZoneSize}%`,
            }}
          />

          {/* Perfect zone (narrower) */}
          <div
            className="absolute top-0 h-full bg-[#fbbf24]/40"
            style={{
              left: `${50 - PERFECT_ZONE / 2}%`,
              width: `${PERFECT_ZONE}%`,
            }}
          />

          {/* Center line */}
          <div className="absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 bg-white" />

          {/* Moving indicator */}
          <div
            className="absolute top-1 h-14 w-3 -translate-x-1/2 rounded-full bg-white shadow-[0_0_20px_rgba(255,255,255,0.8)] transition-none"
            style={{ left: `${meterPercent}%` }}
          />
        </div>

        {/* Zone labels */}
        <div className="mt-2 flex justify-between text-xs text-white/40">
          <span>LOW</span>
          <span className="text-[#fbbf24]">OPTIMAL</span>
          <span>HIGH</span>
        </div>
      </div>

      {/* Phase indicator */}
      <div className="mb-6 h-12 text-center">
        {phase === "charging" && (
          <p className="animate-pulse text-lg font-medium text-[#facc15]">
            Tap or press SPACE to lock power!
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
            Power Grid Charged!
          </p>
        )}
      </div>

      {/* Tap area button */}
      <button
        onClick={handleTap}
        disabled={phase !== "charging"}
        className={`flex h-24 w-24 items-center justify-center rounded-full border-4 text-4xl transition-all ${
          phase === "charging"
            ? "border-[#facc15] bg-[#facc15]/20 hover:bg-[#facc15]/30 active:scale-95"
            : "border-white/20 bg-white/5"
        }`}
      >
        ⚡
      </button>

      {/* Difficulty indicators */}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs text-white/40">
        {difficulty.phase === "night" && (
          <div className="flex items-center gap-1">
            <span className="text-purple-400">🌙</span>
            <span>Night mode: Faster meter</span>
          </div>
        )}
        {difficulty.rust_level > 0.5 && (
          <div className="flex items-center gap-1">
            <span className="text-orange-400">🔥</span>
            <span>High rust: Extra precision needed</span>
          </div>
        )}
      </div>
    </div>
  );
}
