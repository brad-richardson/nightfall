"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { MinigameDifficulty } from "../../../store";

type LevelOutProps = {
  config: {
    base_rounds: number;
    max_score: number;
    expected_duration_ms: number;
  };
  difficulty: MinigameDifficulty;
  onComplete: (score: number) => void;
};

type GamePhase = "ready" | "playing" | "holding" | "result" | "complete";

// How centered the bubble needs to be (in degrees from center)
const PERFECT_THRESHOLD = 2;
const GREAT_THRESHOLD = 5;
const GOOD_THRESHOLD = 10;

// Physics constants
const BASE_DRIFT_SPEED = 15; // degrees per second natural drift
const NUDGE_FORCE = 40; // degrees per second when tapping
const FRICTION = 0.92; // velocity decay per frame
const HOLD_TIME_REQUIRED = 800; // ms to hold in zone to complete

// Visual constants
const LEVEL_WIDTH = 280;
const LEVEL_HEIGHT = 50;
const BUBBLE_SIZE = 24;

export default function LevelOut({ config, difficulty, onComplete }: LevelOutProps) {
  const [phase, setPhase] = useState<GamePhase>("ready");
  const [countdown, setCountdown] = useState(3);
  const [currentRound, setCurrentRound] = useState(0);
  const [score, setScore] = useState(0);
  const [lastResult, setLastResult] = useState<{ zone: string; points: number; color: string } | null>(null);

  // Bubble physics state
  const [bubblePosition, setBubblePosition] = useState(0); // -45 to 45 degrees
  const [velocity, setVelocity] = useState(0);
  const [holdProgress, setHoldProgress] = useState(0);
  const [isHolding, setIsHolding] = useState(false);

  // Input state
  const [leftPressed, setLeftPressed] = useState(false);
  const [rightPressed, setRightPressed] = useState(false);

  const animationRef = useRef<number>();
  const lastTimeRef = useRef<number>(0);
  const scoreRef = useRef(score);
  const holdStartRef = useRef<number | null>(null);
  const resultTimeoutRef = useRef<NodeJS.Timeout>();

  scoreRef.current = score;

  const roundsNeeded = config.base_rounds;
  const driftSpeed = BASE_DRIFT_SPEED * difficulty.speed_mult;
  const holdTimeRequired = HOLD_TIME_REQUIRED / difficulty.window_mult;

  // Thresholds scaled by difficulty
  const perfectThreshold = PERFECT_THRESHOLD * difficulty.window_mult;
  const greatThreshold = GREAT_THRESHOLD * difficulty.window_mult;
  const goodThreshold = GOOD_THRESHOLD * difficulty.window_mult;

  // Start a new round with random initial position
  const startNewRound = useCallback(() => {
    // Random starting position between -30 and 30 degrees
    const startPos = (Math.random() - 0.5) * 60;
    setBubblePosition(startPos);
    // Random initial velocity
    setVelocity((Math.random() - 0.5) * 20);
    setHoldProgress(0);
    setIsHolding(false);
    holdStartRef.current = null;
  }, []);

  // Calculate points based on final position accuracy
  const calculatePoints = useCallback(
    (position: number) => {
      const absPos = Math.abs(position);
      const roundPoints = Math.round(config.max_score / roundsNeeded);

      if (absPos <= perfectThreshold) {
        return { zone: "PERFECT!", points: roundPoints, color: "#fbbf24" };
      } else if (absPos <= greatThreshold) {
        return { zone: "GREAT!", points: Math.round(roundPoints * 0.75), color: "#4ade80" };
      } else if (absPos <= goodThreshold) {
        return { zone: "GOOD", points: Math.round(roundPoints * 0.5), color: "#60a5fa" };
      } else {
        return { zone: "OFF", points: Math.round(roundPoints * 0.2), color: "#ef4444" };
      }
    },
    [config.max_score, roundsNeeded, perfectThreshold, greatThreshold, goodThreshold]
  );

  // Handle round complete
  const handleRoundComplete = useCallback(
    (result: { zone: string; points: number; color: string }) => {
      setLastResult(result);
      setScore((s) => s + result.points);
      setPhase("result");

      resultTimeoutRef.current = setTimeout(() => {
        const newRound = currentRound + 1;
        if (newRound >= roundsNeeded) {
          setPhase("complete");
          onComplete(scoreRef.current + result.points);
        } else {
          setCurrentRound(newRound);
          startNewRound();
          setLastResult(null);
          setPhase("playing");
        }
      }, 600);
    },
    [currentRound, roundsNeeded, startNewRound, onComplete]
  );

  // Cleanup
  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (resultTimeoutRef.current) clearTimeout(resultTimeoutRef.current);
    };
  }, []);

  // Countdown
  useEffect(() => {
    if (phase !== "ready") return;

    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      startNewRound();
      setPhase("playing");
    }
  }, [countdown, phase, startNewRound]);

  // Main game loop
  useEffect(() => {
    if (phase !== "playing" && phase !== "holding") {
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

      // Apply input forces
      let inputForce = 0;
      if (leftPressed) inputForce -= NUDGE_FORCE;
      if (rightPressed) inputForce += NUDGE_FORCE;

      // Natural drift (simulates uneven ground)
      const drift = Math.sin(time / 500) * driftSpeed * 0.3 +
                   Math.sin(time / 1200) * driftSpeed * 0.2;

      // Update velocity with input, drift, and friction
      setVelocity((v) => {
        const newV = (v + inputForce * delta + drift * delta) * FRICTION;
        return Math.max(-100, Math.min(100, newV));
      });

      // Update position
      setBubblePosition((pos) => {
        const newPos = pos + velocity * delta;
        // Clamp and bounce at edges
        if (newPos < -40) return -40 + Math.abs(newPos + 40) * 0.3;
        if (newPos > 40) return 40 - (newPos - 40) * 0.3;
        return newPos;
      });

      // Check if bubble is centered enough to hold
      const absPos = Math.abs(bubblePosition);
      if (absPos <= goodThreshold) {
        if (!holdStartRef.current) {
          holdStartRef.current = time;
          setIsHolding(true);
        }

        const holdDuration = time - holdStartRef.current;
        const progress = Math.min(1, holdDuration / holdTimeRequired);
        setHoldProgress(progress);

        if (progress >= 1) {
          // Round complete!
          const result = calculatePoints(bubblePosition);
          handleRoundComplete(result);
          return;
        }
      } else {
        // Reset hold if bubble drifts out
        if (holdStartRef.current) {
          holdStartRef.current = null;
          setIsHolding(false);
          setHoldProgress(0);
        }
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
  }, [phase, velocity, bubblePosition, leftPressed, rightPressed, driftSpeed, goodThreshold, holdTimeRequired, calculatePoints, handleRoundComplete]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (phase !== "playing" && phase !== "holding") return;

      if (e.code === "ArrowLeft" || e.code === "KeyA") {
        e.preventDefault();
        setLeftPressed(true);
      } else if (e.code === "ArrowRight" || e.code === "KeyD") {
        e.preventDefault();
        setRightPressed(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "ArrowLeft" || e.code === "KeyA") {
        setLeftPressed(false);
      } else if (e.code === "ArrowRight" || e.code === "KeyD") {
        setRightPressed(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [phase]);

  // Calculate bubble visual position (percentage across the level)
  const bubblePercent = 50 + (bubblePosition / 40) * 45; // 5% to 95%

  // Get zone color for current position
  const getZoneColor = () => {
    const absPos = Math.abs(bubblePosition);
    if (absPos <= perfectThreshold) return "#fbbf24";
    if (absPos <= greatThreshold) return "#4ade80";
    if (absPos <= goodThreshold) return "#60a5fa";
    return "#ef4444";
  };

  // Render countdown
  if (phase === "ready") {
    return (
      <div className="flex flex-col items-center justify-center">
        <p className="mb-4 text-lg text-white/60">Level the road surface!</p>
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-amber-500/20 text-5xl font-bold text-amber-400">
          {countdown}
        </div>
        <p className="mt-4 text-sm text-white/40">Use arrow keys or buttons to balance</p>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-md flex-col items-center">
      {/* Status bar */}
      <div className="mb-4 flex w-full items-center justify-between text-sm">
        <div className="text-white/60">
          Section <span className="font-bold text-white">{currentRound + 1}</span> / {roundsNeeded}
        </div>
        <div className="text-white/60">
          Score: <span className="font-bold text-amber-400">{score}</span>
        </div>
      </div>

      {/* Road surface visualization */}
      <div className="mb-4 relative w-full h-32 rounded-xl overflow-hidden border-2 border-white/10 bg-gradient-to-b from-gray-600 to-gray-700">
        {/* Asphalt texture */}
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: `radial-gradient(circle at 20% 30%, #4b5563 2px, transparent 2px),
                              radial-gradient(circle at 80% 60%, #4b5563 1px, transparent 1px)`,
            backgroundSize: "30px 30px",
          }}
        />

        {/* Tilt indicator lines */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ transform: `rotate(${bubblePosition * 0.5}deg)` }}
        >
          <div className="w-full h-0.5 bg-yellow-400/30" />
        </div>

        {/* Road section label */}
        <div className="absolute top-2 left-2 rounded bg-black/40 px-2 py-1 text-xs text-white/60">
          Fresh Asphalt
        </div>

        {/* "Workers" visual feedback */}
        <div className="absolute bottom-2 left-4 text-2xl" style={{ opacity: leftPressed ? 1 : 0.3 }}>
          👷
        </div>
        <div className="absolute bottom-2 right-4 text-2xl" style={{ opacity: rightPressed ? 1 : 0.3 }}>
          👷
        </div>
      </div>

      {/* Spirit level */}
      <div className="mb-4 w-full">
        <div className="mb-2 text-center text-xs text-white/40">SPIRIT LEVEL</div>
        <div
          className="relative mx-auto rounded-full border-2 border-white/20 bg-gradient-to-b from-green-900/80 to-green-950/80"
          style={{ width: LEVEL_WIDTH, height: LEVEL_HEIGHT }}
        >
          {/* Zone indicators */}
          <div className="absolute inset-0 flex items-center justify-center">
            {/* Perfect zone */}
            <div
              className="absolute h-full bg-amber-400/20 border-x border-amber-400/40"
              style={{
                width: `${(perfectThreshold / 40) * 90}%`,
                left: `${50 - (perfectThreshold / 40) * 45}%`,
              }}
            />
            {/* Great zone */}
            <div
              className="absolute h-full bg-green-400/10"
              style={{
                width: `${((greatThreshold - perfectThreshold) / 40) * 90}%`,
                left: `${50 - (greatThreshold / 40) * 45}%`,
              }}
            />
            <div
              className="absolute h-full bg-green-400/10"
              style={{
                width: `${((greatThreshold - perfectThreshold) / 40) * 90}%`,
                right: `${50 - (greatThreshold / 40) * 45}%`,
              }}
            />
          </div>

          {/* Center line */}
          <div className="absolute left-1/2 top-0 bottom-0 w-0.5 -translate-x-1/2 bg-white/40" />

          {/* Tick marks */}
          {[-30, -20, -10, 0, 10, 20, 30].map((tick) => (
            <div
              key={tick}
              className="absolute top-0 h-2 w-0.5 bg-white/20"
              style={{ left: `${50 + (tick / 40) * 45}%` }}
            />
          ))}

          {/* Bubble */}
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full transition-all duration-75"
            style={{
              left: `${bubblePercent}%`,
              width: BUBBLE_SIZE,
              height: BUBBLE_SIZE,
              background: `radial-gradient(circle at 30% 30%, rgba(255,255,255,0.9), ${getZoneColor()})`,
              boxShadow: `0 0 10px ${getZoneColor()}80, inset 0 -2px 4px rgba(0,0,0,0.3)`,
            }}
          />
        </div>
      </div>

      {/* Hold progress bar */}
      <div className="mb-4 w-full">
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="text-white/40">Hold steady...</span>
          <span className={isHolding ? "text-green-400" : "text-white/40"}>
            {isHolding ? `${Math.round(holdProgress * 100)}%` : "—"}
          </span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-white/10 border border-white/10">
          <div
            className={`h-full transition-all duration-100 ${
              isHolding
                ? "bg-gradient-to-r from-green-500 to-amber-400"
                : "bg-gray-600"
            }`}
            style={{ width: `${holdProgress * 100}%` }}
          />
        </div>
      </div>

      {/* Control buttons */}
      <div className="mb-4 flex items-center gap-6">
        <button
          type="button"
          onPointerDown={() => setLeftPressed(true)}
          onPointerUp={() => setLeftPressed(false)}
          onPointerLeave={() => setLeftPressed(false)}
          disabled={phase !== "playing" && phase !== "holding"}
          className={`flex h-16 w-16 items-center justify-center rounded-2xl text-2xl font-bold transition-all ${
            leftPressed
              ? "bg-amber-500 text-white scale-95 shadow-inner"
              : "bg-white/10 text-white/60 hover:bg-white/20"
          } disabled:opacity-50`}
          aria-label="Tilt left"
        >
          ←
        </button>

        <div className="text-center">
          <div className="text-xs text-white/40">or use</div>
          <div className="text-xs text-white/60">A / D keys</div>
        </div>

        <button
          type="button"
          onPointerDown={() => setRightPressed(true)}
          onPointerUp={() => setRightPressed(false)}
          onPointerLeave={() => setRightPressed(false)}
          disabled={phase !== "playing" && phase !== "holding"}
          className={`flex h-16 w-16 items-center justify-center rounded-2xl text-2xl font-bold transition-all ${
            rightPressed
              ? "bg-amber-500 text-white scale-95 shadow-inner"
              : "bg-white/10 text-white/60 hover:bg-white/20"
          } disabled:opacity-50`}
          aria-label="Tilt right"
        >
          →
        </button>
      </div>

      {/* Result display */}
      <div className="h-12 text-center" aria-live="polite">
        {phase === "result" && lastResult && (
          <div className="flex flex-col items-center animate-bounce">
            <p className="text-2xl font-bold" style={{ color: lastResult.color }}>
              {lastResult.zone}
            </p>
            <p className="text-sm text-white/60">+{lastResult.points} points</p>
          </div>
        )}
        {(phase === "playing" || phase === "holding") && (
          <p className="text-sm text-white/40">
            {isHolding ? "Keep it steady!" : "Center the bubble and hold!"}
          </p>
        )}
        {phase === "complete" && (
          <p className="text-xl font-bold text-green-400">Road Leveled!</p>
        )}
      </div>

      {/* Difficulty indicators */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs text-white/40">
        {difficulty.phase === "night" && (
          <div className="flex items-center gap-1">
            <span className="text-purple-400">*</span>
            <span>Night mode: More drift</span>
          </div>
        )}
        {difficulty.rust_level > 0.5 && (
          <div className="flex items-center gap-1">
            <span className="text-orange-400">!</span>
            <span>High rust: Smaller target</span>
          </div>
        )}
      </div>
    </div>
  );
}
