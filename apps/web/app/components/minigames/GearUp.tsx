"use client";

import { useState, useEffect, useCallback, useRef, useMemo, memo } from "react";
import type { MinigameDifficulty } from "../../store";

type GearUpProps = {
  config: {
    base_rounds: number;
    max_score: number;
    expected_duration_ms: number;
  };
  difficulty: MinigameDifficulty;
  onComplete: (score: number) => void;
};

type GamePhase = "ready" | "playing" | "result" | "complete";

// Gear has 8 teeth, each at 45 degrees apart
const TEETH_COUNT = 8;
const DEGREES_PER_TOOTH = 360 / TEETH_COUNT; // 45 degrees

// Zone thresholds (degrees from perfect alignment)
const PERFECT_ZONE = 5; // Within 5 degrees = perfect
const GREAT_ZONE = 12; // Within 12 degrees = great
const GOOD_ZONE = 20; // Within 20 degrees = good

// Pre-calculate tooth geometry (static, never changes)
function calculateTeethPaths(size: number): string[] {
  const innerRadius = size * 0.35;
  const outerRadius = size * 0.48;
  const toothWidth = 0.4; // radians

  const paths: string[] = [];
  for (let i = 0; i < TEETH_COUNT; i++) {
    const angle = (i * 2 * Math.PI) / TEETH_COUNT;
    const x1 = Math.cos(angle - toothWidth / 2) * innerRadius;
    const y1 = Math.sin(angle - toothWidth / 2) * innerRadius;
    const x2 = Math.cos(angle - toothWidth / 3) * outerRadius;
    const y2 = Math.sin(angle - toothWidth / 3) * outerRadius;
    const x3 = Math.cos(angle + toothWidth / 3) * outerRadius;
    const y3 = Math.sin(angle + toothWidth / 3) * outerRadius;
    const x4 = Math.cos(angle + toothWidth / 2) * innerRadius;
    const y4 = Math.sin(angle + toothWidth / 2) * innerRadius;

    paths.push(`M ${x1} ${y1} L ${x2} ${y2} L ${x3} ${y3} L ${x4} ${y4} Z`);
  }
  return paths;
}

// Memoized SVG Gear component (defined outside to prevent recreation)
type GearProps = {
  rotation: number;
  size: number;
  color: string;
};

const Gear = memo(function Gear({ rotation, size, color }: GearProps) {
  const innerRadius = size * 0.35;

  // Memoize teeth paths calculation
  const teethPaths = useMemo(() => calculateTeethPaths(size), [size]);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`}
      style={{ transform: `rotate(${rotation}deg)` }}
      className="transition-transform duration-0"
    >
      {/* Inner circle */}
      <circle r={innerRadius} fill={color} opacity={0.9} />
      {/* Center hole */}
      <circle r={size * 0.12} fill="#1a1d21" />
      {/* Teeth */}
      {teethPaths.map((d, i) => (
        <path key={i} d={d} fill={color} />
      ))}
      {/* Highlight */}
      <circle r={innerRadius * 0.6} fill="none" stroke="white" strokeWidth={2} opacity={0.2} />
    </svg>
  );
});

// Calculate how close the gears are to meshing (teeth aligned)
function calculateMeshAccuracy(leftRotation: number, rightRotation: number): number {
  // For gears to mesh, their teeth need to interlock
  // This means one gear's tooth should align with the other gear's gap
  // A gap is at tooth_position + 22.5 degrees (half a tooth)
  const normalizedLeft = ((leftRotation % DEGREES_PER_TOOTH) + DEGREES_PER_TOOTH) % DEGREES_PER_TOOTH;
  const normalizedRight = ((rightRotation % DEGREES_PER_TOOTH) + DEGREES_PER_TOOTH) % DEGREES_PER_TOOTH;

  // The offset should be half a tooth for perfect meshing
  const idealOffset = DEGREES_PER_TOOTH / 2; // 22.5 degrees
  const actualOffset = Math.abs(normalizedLeft - normalizedRight);

  // Calculate how far from ideal offset we are
  const error = Math.abs(actualOffset - idealOffset);
  // Also check the complementary case (wrap-around)
  const errorAlt = Math.abs(DEGREES_PER_TOOTH - actualOffset - idealOffset);

  return Math.min(error, errorAlt);
}

export default function GearUp({ config, difficulty, onComplete }: GearUpProps) {
  const [phase, setPhase] = useState<GamePhase>("ready");
  const [countdown, setCountdown] = useState(3);
  const [rightGearRotation, setRightGearRotation] = useState(0);
  const [leftGearRotation, setLeftGearRotation] = useState(0);
  const [leftGearEngaged, setLeftGearEngaged] = useState(false);
  const [meshesCompleted, setMeshesCompleted] = useState(0);
  const [score, setScore] = useState(0);
  const [lastResult, setLastResult] = useState<{ zone: string; points: number; color: string } | null>(null);

  const animationRef = useRef<number>();
  const lastTimeRef = useRef<number>(0);
  const scoreRef = useRef(score);
  const resultTimeoutRef = useRef<NodeJS.Timeout>();

  scoreRef.current = score;

  // Speed increases with difficulty
  const baseSpeed = 90; // degrees per second at speed_mult = 1
  const speed = baseSpeed * difficulty.speed_mult;

  // Total meshes needed
  const meshesNeeded = config.base_rounds + difficulty.extra_rounds;

  // Points per mesh based on accuracy
  const getMeshPoints = useCallback((error: number) => {
    const meshPoints = Math.round(config.max_score / meshesNeeded);
    // Apply window_mult to zones (smaller zones when window_mult < 1)
    const perfectZone = PERFECT_ZONE * difficulty.window_mult;
    const greatZone = GREAT_ZONE * difficulty.window_mult;
    const goodZone = GOOD_ZONE * difficulty.window_mult;

    if (error <= perfectZone) {
      return { zone: "PERFECT!", points: meshPoints, color: "#fbbf24" };
    } else if (error <= greatZone) {
      return { zone: "GREAT!", points: Math.round(meshPoints * 0.75), color: "#4ade80" };
    } else if (error <= goodZone) {
      return { zone: "GOOD", points: Math.round(meshPoints * 0.5), color: "#60a5fa" };
    } else {
      return { zone: "MISS", points: Math.round(meshPoints * 0.1), color: "#ef4444" };
    }
  }, [config.max_score, meshesNeeded, difficulty.window_mult]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (resultTimeoutRef.current) clearTimeout(resultTimeoutRef.current);
    };
  }, []);

  // Animation loop for gear rotation
  useEffect(() => {
    if (phase !== "playing") {
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

      // Right gear always spins clockwise
      setRightGearRotation((prev) => (prev + speed * delta) % 360);

      // Left gear spins counter-clockwise when engaged
      // Normalize to 0-360 range to avoid negative accumulation
      if (leftGearEngaged) {
        setLeftGearRotation((prev) => ((prev - speed * delta) % 360 + 360) % 360);
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    lastTimeRef.current = 0;
    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [phase, speed, leftGearEngaged]);

  // Countdown before game starts
  useEffect(() => {
    if (phase !== "ready") return;

    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      setPhase("playing");
      // Start with left gear disengaged, random initial position
      setLeftGearRotation(Math.random() * 360);
      setRightGearRotation(Math.random() * 360);
    }
  }, [countdown, phase]);

  const handleMesh = useCallback(() => {
    if (phase !== "playing") return;

    // Engage the left gear
    setLeftGearEngaged(true);

    // Calculate mesh accuracy
    const error = calculateMeshAccuracy(leftGearRotation, rightGearRotation);
    const result = getMeshPoints(error);

    setLastResult(result);
    setScore((s) => s + result.points);
    setMeshesCompleted((m) => m + 1);
    setPhase("result");

    // After showing result, continue or complete
    resultTimeoutRef.current = setTimeout(() => {
      const newMeshesCompleted = meshesCompleted + 1;

      if (newMeshesCompleted >= meshesNeeded) {
        setPhase("complete");
        onComplete(scoreRef.current + result.points);
      } else {
        // Reset for next mesh
        setLeftGearEngaged(false);
        setLeftGearRotation(Math.random() * 360);
        setLastResult(null);
        setPhase("playing");
      }
    }, 700);
  }, [phase, leftGearRotation, rightGearRotation, meshesCompleted, meshesNeeded, getMeshPoints, onComplete]);

  // Handle keyboard input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        handleMesh();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleMesh]);

  // Render countdown
  if (phase === "ready") {
    return (
      <div className="flex flex-col items-center justify-center">
        <p className="mb-4 text-lg text-white/60">Time the mesh!</p>
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[#f97316]/20 text-5xl font-bold text-[#f97316]">
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
          Mesh <span className="font-bold text-white">{meshesCompleted + 1}</span> / {meshesNeeded}
        </div>
        <div className="text-white/60">
          Score: <span className="font-bold text-[#f97316]">{score}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-8 h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full bg-gradient-to-r from-[#f97316] to-[#fb923c] transition-all duration-300"
          style={{ width: `${(meshesCompleted / meshesNeeded) * 100}%` }}
        />
      </div>

      {/* Gear visualization area */}
      <div className="relative mb-6 flex h-48 w-full items-center justify-center">
        {/* Left gear (player controlled) */}
        <div className="absolute left-[15%] flex flex-col items-center">
          <Gear
            rotation={leftGearRotation}
            size={100}
            color={leftGearEngaged ? "#f97316" : "#6b7280"}
          />
          <span className="mt-2 text-xs text-white/40">Your Gear</span>
        </div>

        {/* Right gear (always spinning) */}
        <div className="absolute right-[15%] flex flex-col items-center">
          <Gear
            rotation={rightGearRotation}
            size={100}
            color="#f97316"
          />
          <span className="mt-2 text-xs text-white/40">Target Gear</span>
        </div>

        {/* Mesh indicator zone */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className={`flex h-16 w-16 items-center justify-center rounded-full border-4 ${
            leftGearEngaged
              ? lastResult?.color === "#fbbf24"
                ? "border-[#fbbf24] bg-[#fbbf24]/20"
                : lastResult?.color === "#4ade80"
                  ? "border-[#4ade80] bg-[#4ade80]/20"
                  : lastResult?.color === "#60a5fa"
                    ? "border-[#60a5fa] bg-[#60a5fa]/20"
                    : "border-[#ef4444] bg-[#ef4444]/20"
              : "border-white/20 bg-white/5"
          }`}>
            {leftGearEngaged ? (
              <span className="text-2xl">⚙️</span>
            ) : (
              <span className="text-xl animate-pulse">⚡</span>
            )}
          </div>
        </div>
      </div>

      {/* Phase indicator */}
      <div className="mb-6 h-12 text-center">
        {phase === "playing" && !leftGearEngaged && (
          <p className="animate-pulse text-lg font-medium text-[#f97316]">
            Tap when teeth align!
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
            Gears Synced!
          </p>
        )}
      </div>

      {/* Mesh button - with explicit touch handling for mobile */}
      <button
        onClick={handleMesh}
        onTouchEnd={(e) => {
          e.preventDefault();
          handleMesh();
        }}
        disabled={phase !== "playing" || leftGearEngaged}
        aria-label="Mesh gears"
        className={`flex h-24 w-24 items-center justify-center rounded-full border-4 text-4xl transition-all ${
          phase === "playing" && !leftGearEngaged
            ? "border-[#f97316] bg-[#f97316]/20 hover:bg-[#f97316]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a1d21] active:scale-95"
            : "border-white/20 bg-white/5"
        }`}
        style={{ touchAction: "manipulation" }}
      >
        ⚙️
      </button>

      {/* Hint */}
      <p className="mt-4 text-center text-xs text-white/40">
        Press <kbd className="rounded bg-white/10 px-1.5 py-0.5">Space</kbd> or tap to mesh
      </p>

      {/* Difficulty indicators */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-white/40">
        {difficulty.phase === "night" && (
          <div className="flex items-center gap-1">
            <span className="text-purple-400">🌙</span>
            <span>Night mode: Faster rotation</span>
          </div>
        )}
        {difficulty.rust_level > 0.5 && (
          <div className="flex items-center gap-1">
            <span className="text-orange-400">🔥</span>
            <span>High rust: Tighter timing</span>
          </div>
        )}
      </div>
    </div>
  );
}
