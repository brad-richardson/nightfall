"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { MinigameDifficulty } from "../../../store";

type PotholePatrolProps = {
  config: {
    base_rounds: number;
    max_score: number;
    expected_duration_ms: number;
  };
  difficulty: MinigameDifficulty;
  onComplete: (score: number) => void;
};

type GamePhase = "ready" | "playing" | "result" | "complete";

type Pothole = {
  id: string;
  x: number;
  y: number;
  size: "small" | "medium" | "large";
  createdAt: number;
  filledAt?: number;
  expired?: boolean;
};

// Score values
const SCORE_PERFECT = 150; // Hit within first 30% of lifetime
const SCORE_GOOD = 100;    // Hit within 30-70% of lifetime
const SCORE_LATE = 50;     // Hit within 70-100% of lifetime
const SCORE_MISS = -25;    // Pothole expired

// Timing constants (in ms)
const BASE_POTHOLE_LIFETIME = 2000;
const BASE_SPAWN_INTERVAL = 800;

// Size configurations
const SIZE_CONFIG = {
  small: { radius: 20, points: 1.2 },
  medium: { radius: 30, points: 1.0 },
  large: { radius: 40, points: 0.8 },
};

export default function PotholePatrol({ config, difficulty, onComplete }: PotholePatrolProps) {
  const [phase, setPhase] = useState<GamePhase>("ready");
  const [countdown, setCountdown] = useState(3);
  const [score, setScore] = useState(0);
  const [potholes, setPotholes] = useState<Pothole[]>([]);
  const [combo, setCombo] = useState(0);
  const [lastHitResult, setLastHitResult] = useState<{ points: number; x: number; y: number } | null>(null);
  const [filled, setFilled] = useState(0);
  const [missed, setMissed] = useState(0);

  const gameAreaRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>();
  const lastSpawnRef = useRef<number>(0);
  const scoreRef = useRef(score);
  const potholesSpawnedRef = useRef(0);

  scoreRef.current = score;

  const gameWidth = 320;
  const gameHeight = 280;

  // Total potholes to spawn
  const totalPotholes = config.base_rounds;

  // Adjust timing based on difficulty
  const potholeLifetime = BASE_POTHOLE_LIFETIME / difficulty.speed_mult;
  const spawnInterval = BASE_SPAWN_INTERVAL / difficulty.speed_mult;

  // Generate random pothole position
  const generatePothole = useCallback((): Pothole => {
    const sizes: Array<"small" | "medium" | "large"> = ["small", "medium", "large"];
    const size = sizes[Math.floor(Math.random() * sizes.length)];
    const radius = SIZE_CONFIG[size].radius;

    return {
      id: `pothole-${Date.now()}-${Math.random()}`,
      x: radius + Math.random() * (gameWidth - radius * 2),
      y: radius + Math.random() * (gameHeight - radius * 2),
      size,
      createdAt: Date.now(),
    };
  }, [gameWidth, gameHeight]);

  // Handle pothole tap
  const handlePotholeTap = useCallback((pothole: Pothole) => {
    if (phase !== "playing" || pothole.filledAt || pothole.expired) return;

    const now = Date.now();
    const age = now - pothole.createdAt;
    const lifetime = potholeLifetime;
    const agePercent = age / lifetime;

    let points: number;

    if (agePercent < 0.3) {
      points = SCORE_PERFECT;
    } else if (agePercent < 0.7) {
      points = SCORE_GOOD;
    } else {
      points = SCORE_LATE;
    }

    // Apply size multiplier and combo
    const sizeMultiplier = SIZE_CONFIG[pothole.size].points;
    const comboMultiplier = 1 + combo * 0.1;
    const finalPoints = Math.round(points * sizeMultiplier * comboMultiplier);

    setScore((s) => s + finalPoints);
    setCombo((c) => c + 1);
    setFilled((f) => f + 1);
    setLastHitResult({ points: finalPoints, x: pothole.x, y: pothole.y });

    setPotholes((prev) =>
      prev.map((p) =>
        p.id === pothole.id ? { ...p, filledAt: now } : p
      )
    );

    // Clear hit result after animation
    setTimeout(() => setLastHitResult(null), 400);
  }, [phase, potholeLifetime, combo]);

  // Countdown before game starts
  useEffect(() => {
    if (phase !== "ready") return;

    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      setPhase("playing");
      lastSpawnRef.current = Date.now();
    }
  }, [countdown, phase]);

  // Game loop
  useEffect(() => {
    if (phase !== "playing") {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      return;
    }

    const animate = () => {
      const now = Date.now();

      // Spawn new potholes
      if (
        potholesSpawnedRef.current < totalPotholes &&
        now - lastSpawnRef.current > spawnInterval
      ) {
        lastSpawnRef.current = now;
        potholesSpawnedRef.current += 1;
        setPotholes((prev) => [...prev, generatePothole()]);
      }

      // Check for expired potholes
      setPotholes((prev) => {
        let newMissed = 0;
        const updated = prev.map((p) => {
          if (!p.filledAt && !p.expired && now - p.createdAt > potholeLifetime) {
            newMissed++;
            return { ...p, expired: true };
          }
          return p;
        });

        if (newMissed > 0) {
          setMissed((m) => m + newMissed);
          setScore((s) => Math.max(0, s + SCORE_MISS * newMissed));
          setCombo(0);
        }

        return updated;
      });

      // Check game end condition
      const activePotholes = potholes.filter((p) => !p.filledAt && !p.expired);
      if (
        potholesSpawnedRef.current >= totalPotholes &&
        activePotholes.length === 0
      ) {
        setPhase("complete");
        onComplete(scoreRef.current);
        return;
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [phase, potholes, totalPotholes, spawnInterval, potholeLifetime, generatePothole, onComplete]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  // Render countdown
  if (phase === "ready") {
    return (
      <div className="flex flex-col items-center justify-center">
        <p className="mb-4 text-lg text-white/60">Tap the potholes to fill them!</p>
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-amber-500/20 text-5xl font-bold text-amber-400">
          {countdown}
        </div>
        <p className="mt-4 text-sm text-white/40">Get ready...</p>
      </div>
    );
  }

  const progress = (filled + missed) / totalPotholes;

  return (
    <div className="flex w-full max-w-md flex-col items-center">
      {/* Status bar */}
      <div className="mb-4 flex w-full items-center justify-between text-sm">
        <div className="text-white/60">
          Filled: <span className="font-bold text-green-400">{filled}</span> / {totalPotholes}
        </div>
        <div className="text-white/60">
          Score: <span className="font-bold text-amber-400">{score}</span>
        </div>
      </div>

      {/* Combo indicator */}
      {combo > 1 && (
        <div className="mb-2 rounded-full bg-purple-500/20 px-3 py-1 text-sm font-bold text-purple-400">
          {combo}x COMBO!
        </div>
      )}

      {/* Progress bar */}
      <div className="mb-4 w-full">
        <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full bg-gradient-to-r from-amber-500 to-green-500 transition-all duration-300"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>

      {/* Game area */}
      <div
        ref={gameAreaRef}
        className="relative mb-4 overflow-hidden rounded-2xl border-2 border-white/10 bg-gradient-to-b from-gray-700 to-gray-800"
        style={{ width: gameWidth, height: gameHeight, touchAction: "none" }}
      >
        {/* Asphalt texture */}
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: `radial-gradient(circle at 10% 20%, #4b5563 1px, transparent 1px),
                              radial-gradient(circle at 80% 60%, #4b5563 1px, transparent 1px),
                              radial-gradient(circle at 40% 80%, #4b5563 1px, transparent 1px)`,
            backgroundSize: "30px 30px",
          }}
        />

        {/* Road markings */}
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 border-t-2 border-dashed border-yellow-400/40" />

        {/* Potholes */}
        {potholes.map((pothole) => {
          const sizeConfig = SIZE_CONFIG[pothole.size];
          const age = Date.now() - pothole.createdAt;
          const lifePercent = Math.min(1, age / potholeLifetime);
          const isActive = !pothole.filledAt && !pothole.expired;

          return (
            <button
              key={pothole.id}
              type="button"
              onClick={() => handlePotholeTap(pothole)}
              disabled={!isActive}
              className={`absolute rounded-full transition-all duration-150 ${
                pothole.filledAt
                  ? "scale-0 opacity-0"
                  : pothole.expired
                  ? "scale-75 opacity-30"
                  : "cursor-pointer hover:brightness-110"
              }`}
              style={{
                left: pothole.x - sizeConfig.radius,
                top: pothole.y - sizeConfig.radius,
                width: sizeConfig.radius * 2,
                height: sizeConfig.radius * 2,
                background: pothole.expired
                  ? "radial-gradient(circle, #374151 0%, #1f2937 100%)"
                  : `radial-gradient(circle, #1f2937 0%, #111827 60%, ${
                      lifePercent > 0.7 ? "#7f1d1d" : "#374151"
                    } 100%)`,
                boxShadow: isActive
                  ? `inset 0 4px 8px rgba(0,0,0,0.5), 0 0 ${
                      lifePercent > 0.7 ? "12px rgba(239,68,68,0.5)" : "8px rgba(0,0,0,0.3)"
                    }`
                  : "none",
                border: isActive ? "2px solid rgba(255,255,255,0.2)" : "none",
              }}
              aria-label={`${pothole.size} pothole`}
            >
              {/* Warning indicator for about-to-expire */}
              {isActive && lifePercent > 0.7 && (
                <div className="absolute inset-0 animate-pulse rounded-full border-2 border-red-500/50" />
              )}
            </button>
          );
        })}

        {/* Hit result popup */}
        {lastHitResult && (
          <div
            className="pointer-events-none absolute animate-bounce text-lg font-bold text-green-400"
            style={{
              left: lastHitResult.x,
              top: lastHitResult.y - 30,
              transform: "translateX(-50%)",
            }}
          >
            +{lastHitResult.points}
          </div>
        )}
      </div>

      {/* Instructions */}
      <p className="text-center text-xs text-white/40">
        Tap potholes quickly for bonus points! Smaller potholes = more points
      </p>

      {/* Difficulty indicators */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-white/40">
        {difficulty.phase === "night" && (
          <div className="flex items-center gap-1">
            <span className="text-purple-400">🌙</span>
            <span>Night mode: Faster spawns</span>
          </div>
        )}
        {difficulty.rust_level > 0.5 && (
          <div className="flex items-center gap-1">
            <span className="text-orange-400">🔥</span>
            <span>High rust: Shorter lifetime</span>
          </div>
        )}
      </div>
    </div>
  );
}
