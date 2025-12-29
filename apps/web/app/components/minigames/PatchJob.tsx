"use client";

import { useState, useEffect, useCallback, useRef, useMemo, memo } from "react";
import type { MinigameDifficulty } from "../../store";

type PatchJobProps = {
  config: {
    base_rounds: number;
    max_score: number;
    expected_duration_ms: number;
  };
  difficulty: MinigameDifficulty;
  onComplete: (score: number) => void;
};

type GamePhase = "ready" | "playing" | "result" | "complete";

type Point = { x: number; y: number };

type CrackPath = {
  points: Point[];
  controlPoints: Point[];
  length: number;
};

// Zone thresholds (distance from path in pixels)
// Increased for better mobile touch tolerance
const PERFECT_ZONE = 12;
const GREAT_ZONE = 24;
const GOOD_ZONE = 36;

// Path generation constants
const PATH_MARGIN = 40;
const PATH_RANDOMNESS = 60;
const CONTROL_POINT_RANDOMNESS = 40;
const MIN_SEGMENTS = 3;
const MAX_EXTRA_SEGMENTS = 3;

// Game constants
// Reduced initial spread and slower crack growth for more forgiving gameplay
const INITIAL_SPREAD_PROGRESS = 0.2;
const WELD_COMPLETE_THRESHOLD = 0.95;
const BASE_SPREAD_SPEED = 0.055;
const WELD_SPEED = 0.32;
const RESULT_DISPLAY_MS = 700;

// Generate a random crack path
function generateCrackPath(width: number, height: number): CrackPath {
  const points: Point[] = [];
  const controlPoints: Point[] = [];

  // Start from a random edge
  const startEdge = Math.floor(Math.random() * 4);
  let startX: number, startY: number;

  const innerWidth = width - PATH_MARGIN * 2;
  const innerHeight = height - PATH_MARGIN * 2;

  switch (startEdge) {
    case 0: // Top
      startX = PATH_MARGIN + Math.random() * innerWidth;
      startY = PATH_MARGIN;
      break;
    case 1: // Right
      startX = width - PATH_MARGIN;
      startY = PATH_MARGIN + Math.random() * innerHeight;
      break;
    case 2: // Bottom
      startX = PATH_MARGIN + Math.random() * innerWidth;
      startY = height - PATH_MARGIN;
      break;
    default: // Left
      startX = PATH_MARGIN;
      startY = PATH_MARGIN + Math.random() * innerHeight;
  }

  points.push({ x: startX, y: startY });

  // Generate intermediate points moving generally toward center then away
  const numSegments = MIN_SEGMENTS + Math.floor(Math.random() * MAX_EXTRA_SEGMENTS);
  const centerX = width / 2;
  const centerY = height / 2;

  for (let i = 1; i <= numSegments; i++) {
    const t = i / numSegments;
    // Move toward center in first half, then away
    const targetX = t < 0.5
      ? startX + (centerX - startX) * (t * 2) + (Math.random() - 0.5) * PATH_RANDOMNESS
      : centerX + (width - PATH_MARGIN - centerX) * ((t - 0.5) * 2) * (Math.random() > 0.5 ? 1 : -1) + (Math.random() - 0.5) * PATH_RANDOMNESS;
    const targetY = t < 0.5
      ? startY + (centerY - startY) * (t * 2) + (Math.random() - 0.5) * PATH_RANDOMNESS
      : centerY + (height - PATH_MARGIN - centerY) * ((t - 0.5) * 2) * (Math.random() > 0.5 ? 1 : -1) + (Math.random() - 0.5) * PATH_RANDOMNESS;

    // Clamp to bounds
    points.push({
      x: Math.max(PATH_MARGIN, Math.min(width - PATH_MARGIN, targetX)),
      y: Math.max(PATH_MARGIN, Math.min(height - PATH_MARGIN, targetY)),
    });
  }

  // Generate control points for smooth curves
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    // Add some randomness to control points
    controlPoints.push({
      x: midX + (Math.random() - 0.5) * CONTROL_POINT_RANDOMNESS,
      y: midY + (Math.random() - 0.5) * CONTROL_POINT_RANDOMNESS,
    });
  }

  // Calculate approximate path length
  let length = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    length += Math.sqrt(dx * dx + dy * dy);
  }

  return { points, controlPoints, length };
}

// Get point on the crack path at a given progress (0-1)
function getPointOnPath(crack: CrackPath, progress: number): Point {
  const totalSegments = crack.points.length - 1;
  const segmentProgress = progress * totalSegments;
  const segmentIndex = Math.min(Math.floor(segmentProgress), totalSegments - 1);
  const t = segmentProgress - segmentIndex;

  const p1 = crack.points[segmentIndex];
  const p2 = crack.points[segmentIndex + 1];
  const cp = crack.controlPoints[segmentIndex];

  // Quadratic bezier interpolation
  const x = (1 - t) * (1 - t) * p1.x + 2 * (1 - t) * t * cp.x + t * t * p2.x;
  const y = (1 - t) * (1 - t) * p1.y + 2 * (1 - t) * t * cp.y + t * t * p2.y;

  return { x, y };
}

// Generate SVG path string for crack
function getCrackPathString(crack: CrackPath): string {
  if (crack.points.length < 2) return "";

  let d = `M ${crack.points[0].x} ${crack.points[0].y}`;

  for (let i = 0; i < crack.points.length - 1; i++) {
    const cp = crack.controlPoints[i];
    const end = crack.points[i + 1];
    d += ` Q ${cp.x} ${cp.y} ${end.x} ${end.y}`;
  }

  return d;
}

// Calculate distance from a point to the nearest point on the path
function getDistanceToPath(crack: CrackPath, point: Point, resolution: number = 50): { distance: number; progress: number } {
  let minDist = Infinity;
  let closestProgress = 0;

  for (let i = 0; i <= resolution; i++) {
    const progress = i / resolution;
    const pathPoint = getPointOnPath(crack, progress);
    const dx = point.x - pathPoint.x;
    const dy = point.y - pathPoint.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < minDist) {
      minDist = dist;
      closestProgress = progress;
    }
  }

  return { distance: minDist, progress: closestProgress };
}

// SVG Crack visualization
type CrackVisualsProps = {
  crack: CrackPath;
  weldProgress: number;
  spreadProgress: number;
  width: number;
  height: number;
};

const CrackVisuals = memo(function CrackVisuals({
  crack,
  weldProgress,
  spreadProgress,
  width,
  height
}: CrackVisualsProps) {
  const pathString = useMemo(() => getCrackPathString(crack), [crack]);

  return (
    <svg width={width} height={height} className="absolute inset-0" aria-hidden="true">
      {/* Background glow for crack */}
      <defs>
        <filter id="crackGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="weldGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id="crackGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#ef4444" />
          <stop offset="100%" stopColor="#991b1b" />
        </linearGradient>
        <linearGradient id="weldGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#fbbf24" />
        </linearGradient>
      </defs>

      {/* Spreading crack (unfilled portion that grows) */}
      <path
        d={pathString}
        fill="none"
        stroke="url(#crackGradient)"
        strokeWidth={6}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={crack.length}
        strokeDashoffset={crack.length * (1 - spreadProgress)}
        filter="url(#crackGlow)"
        opacity={0.8}
      />

      {/* Crack line (thinner, sharper) */}
      <path
        d={pathString}
        fill="none"
        stroke="#1a1d21"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={crack.length}
        strokeDashoffset={crack.length * (1 - spreadProgress)}
      />

      {/* Welded portion */}
      <path
        d={pathString}
        fill="none"
        stroke="url(#weldGradient)"
        strokeWidth={8}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={crack.length}
        strokeDashoffset={crack.length * (1 - weldProgress)}
        filter="url(#weldGlow)"
      />

      {/* Weld seam (metallic look) */}
      <path
        d={pathString}
        fill="none"
        stroke="#fef3c7"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={crack.length}
        strokeDashoffset={crack.length * (1 - weldProgress)}
        opacity={0.6}
      />
    </svg>
  );
});

export default function PatchJob({ config, difficulty, onComplete }: PatchJobProps) {
  const [phase, setPhase] = useState<GamePhase>("ready");
  const [countdown, setCountdown] = useState(3);
  const [currentRound, setCurrentRound] = useState(0);
  const [score, setScore] = useState(0);
  const [lastResult, setLastResult] = useState<{ zone: string; points: number; color: string } | null>(null);

  // Crack state
  const [crack, setCrack] = useState<CrackPath | null>(null);
  const [weldProgress, setWeldProgress] = useState(0);
  const [spreadProgress, setSpreadProgress] = useState(INITIAL_SPREAD_PROGRESS);
  const [isWelding, setIsWelding] = useState(false);
  const [weldPosition, setWeldPosition] = useState<Point | null>(null);

  const gameAreaRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>();
  const lastTimeRef = useRef<number>(0);
  const scoreRef = useRef(score);
  const resultTimeoutRef = useRef<NodeJS.Timeout>();

  // Use refs for accuracy tracking to avoid stale closure issues
  const accuracySumRef = useRef(0);
  const accuracyCountRef = useRef(0);

  scoreRef.current = score;

  const gameWidth = 320;
  const gameHeight = 280;

  // Total rounds needed
  const roundsNeeded = config.base_rounds + difficulty.extra_rounds;

  // Spread speed increases with difficulty
  const spreadSpeed = BASE_SPREAD_SPEED * difficulty.speed_mult;

  // Generate new crack for round
  const generateNewCrack = useCallback(() => {
    const newCrack = generateCrackPath(gameWidth, gameHeight);
    setCrack(newCrack);
    setWeldProgress(0);
    setSpreadProgress(INITIAL_SPREAD_PROGRESS);
    accuracySumRef.current = 0;
    accuracyCountRef.current = 0;
  }, [gameWidth, gameHeight]);

  // Points calculation based on performance
  const getRoundPoints = useCallback((avgAccuracy: number) => {
    const roundPoints = Math.round(config.max_score / roundsNeeded);
    const perfectZone = PERFECT_ZONE * difficulty.window_mult;
    const greatZone = GREAT_ZONE * difficulty.window_mult;
    const goodZone = GOOD_ZONE * difficulty.window_mult;

    if (avgAccuracy <= perfectZone) {
      return { zone: "PERFECT!", points: roundPoints, color: "#fbbf24" };
    } else if (avgAccuracy <= greatZone) {
      return { zone: "GREAT!", points: Math.round(roundPoints * 0.75), color: "#4ade80" };
    } else if (avgAccuracy <= goodZone) {
      return { zone: "GOOD", points: Math.round(roundPoints * 0.5), color: "#60a5fa" };
    } else {
      return { zone: "MISS", points: Math.round(roundPoints * 0.1), color: "#ef4444" };
    }
  }, [config.max_score, roundsNeeded, difficulty.window_mult]);

  // Handle round completion (called outside state updaters)
  const handleRoundComplete = useCallback((result: { zone: string; points: number; color: string }) => {
    setLastResult(result);
    setScore(s => s + result.points);
    setPhase("result");

    resultTimeoutRef.current = setTimeout(() => {
      const newRound = currentRound + 1;
      if (newRound >= roundsNeeded) {
        setPhase("complete");
        onComplete(scoreRef.current + result.points);
      } else {
        setCurrentRound(newRound);
        generateNewCrack();
        setLastResult(null);
        setPhase("playing");
      }
    }, RESULT_DISPLAY_MS);
  }, [currentRound, roundsNeeded, generateNewCrack, onComplete]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (resultTimeoutRef.current) clearTimeout(resultTimeoutRef.current);
    };
  }, []);

  // Countdown before game starts
  useEffect(() => {
    if (phase !== "ready") return;

    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      generateNewCrack();
      setPhase("playing");
    }
  }, [countdown, phase, generateNewCrack]);

  // Game loop - handle crack spreading and welding
  useEffect(() => {
    if (phase !== "playing" || !crack) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      return;
    }

    // Track if round is complete to prevent multiple completions
    let roundComplete = false;

    const animate = (time: number) => {
      if (roundComplete) return;

      if (lastTimeRef.current === 0) {
        lastTimeRef.current = time;
      }

      const delta = (time - lastTimeRef.current) / 1000;
      lastTimeRef.current = time;

      // Crack spreads over time
      setSpreadProgress(prev => {
        const newProgress = Math.min(1, prev + spreadSpeed * delta);

        // Check if crack has fully spread before being welded
        if (!roundComplete && newProgress >= 1 && weldProgress < WELD_COMPLETE_THRESHOLD) {
          roundComplete = true;
          const result = { zone: "TOO SLOW!", points: Math.round(config.max_score / roundsNeeded * 0.1), color: "#ef4444" };
          // Schedule state update outside of the state updater
          queueMicrotask(() => handleRoundComplete(result));
        }

        return newProgress;
      });

      // Handle welding when active and on target
      if (isWelding && weldPosition) {
        const { distance, progress } = getDistanceToPath(crack, weldPosition);

        // Only weld if close enough to the path and ahead of current progress
        if (distance < GOOD_ZONE && progress >= weldProgress - 0.05) {
          // Weld speed is affected by accuracy (already inside GOOD_ZONE check)
          const accuracyMultiplier = distance < PERFECT_ZONE ? 1.0
            : distance < GREAT_ZONE ? 0.8
            : 0.6;

          setWeldProgress(prev => {
            const newProgress = Math.min(spreadProgress, prev + WELD_SPEED * accuracyMultiplier * delta);

            // Track accuracy for scoring using refs
            accuracySumRef.current += distance;
            accuracyCountRef.current += 1;

            // Check if welding is complete
            if (!roundComplete && newProgress >= WELD_COMPLETE_THRESHOLD) {
              roundComplete = true;
              const avgAccuracy = accuracyCountRef.current > 0
                ? accuracySumRef.current / accuracyCountRef.current
                : GOOD_ZONE;
              const result = getRoundPoints(avgAccuracy);
              // Schedule state update outside of the state updater
              queueMicrotask(() => handleRoundComplete(result));
            }

            return newProgress;
          });
        }
      }

      if (!roundComplete) {
        animationRef.current = requestAnimationFrame(animate);
      }
    };

    lastTimeRef.current = 0;
    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [phase, crack, isWelding, weldPosition, weldProgress, spreadProgress, spreadSpeed,
      currentRound, roundsNeeded, config.max_score, getRoundPoints,
      generateNewCrack, handleRoundComplete]);

  // Handle pointer events for welding
  const getRelativePosition = useCallback((clientX: number, clientY: number): Point | null => {
    if (!gameAreaRef.current) return null;
    const rect = gameAreaRef.current.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (phase !== "playing") return;
    e.preventDefault();
    e.stopPropagation();

    // Capture pointer for reliable touch tracking across the element
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const pos = getRelativePosition(e.clientX, e.clientY);
    if (pos) {
      setIsWelding(true);
      setWeldPosition(pos);
    }
  }, [phase, getRelativePosition]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isWelding || phase !== "playing") return;
    e.preventDefault();
    e.stopPropagation();
    const pos = getRelativePosition(e.clientX, e.clientY);
    if (pos) {
      setWeldPosition(pos);
    }
  }, [isWelding, phase, getRelativePosition]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    // Release pointer capture
    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }
    setIsWelding(false);
  }, []);

  const handlePointerCancel = useCallback((e: React.PointerEvent) => {
    // Handle pointer cancel (e.g., system interruption)
    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }
    setIsWelding(false);
  }, []);

  const handlePointerLeave = useCallback((e: React.PointerEvent) => {
    // Only stop welding on leave if we don't have pointer capture
    // (pointer capture keeps tracking even when cursor/finger leaves the element)
    const target = e.currentTarget as HTMLElement;
    if (!target.hasPointerCapture(e.pointerId)) {
      setIsWelding(false);
    }
  }, []);

  // Keyboard accessibility - arrow keys move weld position
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (phase !== "playing") return;

    const MOVE_STEP = 10;
    let newPos: Point | null = null;

    switch (e.key) {
      case "ArrowUp":
      case "w":
      case "W":
        e.preventDefault();
        newPos = weldPosition
          ? { x: weldPosition.x, y: Math.max(0, weldPosition.y - MOVE_STEP) }
          : { x: gameWidth / 2, y: gameHeight / 2 };
        break;
      case "ArrowDown":
      case "s":
      case "S":
        e.preventDefault();
        newPos = weldPosition
          ? { x: weldPosition.x, y: Math.min(gameHeight, weldPosition.y + MOVE_STEP) }
          : { x: gameWidth / 2, y: gameHeight / 2 };
        break;
      case "ArrowLeft":
      case "a":
      case "A":
        e.preventDefault();
        newPos = weldPosition
          ? { x: Math.max(0, weldPosition.x - MOVE_STEP), y: weldPosition.y }
          : { x: gameWidth / 2, y: gameHeight / 2 };
        break;
      case "ArrowRight":
      case "d":
      case "D":
        e.preventDefault();
        newPos = weldPosition
          ? { x: Math.min(gameWidth, weldPosition.x + MOVE_STEP), y: weldPosition.y }
          : { x: gameWidth / 2, y: gameHeight / 2 };
        break;
      case " ":
      case "Enter":
        e.preventDefault();
        if (!isWelding) {
          setIsWelding(true);
          if (!weldPosition) {
            setWeldPosition({ x: gameWidth / 2, y: gameHeight / 2 });
          }
        }
        break;
    }

    if (newPos) {
      setWeldPosition(newPos);
      if (!isWelding) {
        setIsWelding(true);
      }
    }
  }, [phase, weldPosition, isWelding, gameWidth, gameHeight]);

  const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
    if (e.key === " " || e.key === "Enter") {
      setIsWelding(false);
    }
  }, []);

  // Render countdown
  if (phase === "ready") {
    return (
      <div className="flex flex-col items-center justify-center select-none" style={{ WebkitUserSelect: "none" }}>
        <p className="mb-4 text-lg text-white/60">Trace the crack to weld it!</p>
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[#f97316]/20 text-5xl font-bold text-[#f97316]">
          {countdown}
        </div>
        <p className="mt-4 text-sm text-white/40">Get ready...</p>
      </div>
    );
  }

  const weldPercent = Math.round(weldProgress * 100);
  const spreadPercent = Math.round(spreadProgress * 100);

  return (
    <div className="flex w-full max-w-md flex-col items-center select-none" style={{ WebkitUserSelect: "none" }}>
      {/* Status bar */}
      <div className="mb-4 flex w-full items-center justify-between text-sm">
        <div className="text-white/60">
          Crack <span className="font-bold text-white">{currentRound + 1}</span> / {roundsNeeded}
        </div>
        <div className="text-white/60">
          Score: <span className="font-bold text-[#f97316]">{score}</span>
        </div>
      </div>

      {/* Progress bars with ARIA attributes */}
      <div className="mb-2 w-full">
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="text-white/40" id="weld-progress-label">Welded</span>
          <span className="text-[#fbbf24]">{weldPercent}%</span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          aria-valuenow={weldPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-labelledby="weld-progress-label"
        >
          <div
            className="h-full bg-gradient-to-r from-[#f97316] to-[#fbbf24] transition-all duration-100"
            style={{ width: `${weldPercent}%` }}
          />
        </div>
      </div>

      <div className="mb-4 w-full">
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="text-white/40" id="spread-progress-label">Crack Spread</span>
          <span className="text-red-400">{spreadPercent}%</span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          aria-valuenow={spreadPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-labelledby="spread-progress-label"
        >
          <div
            className="h-full bg-gradient-to-r from-[#ef4444] to-[#991b1b] transition-all duration-100"
            style={{ width: `${spreadPercent}%` }}
          />
        </div>
      </div>

      {/* Game area with keyboard accessibility */}
      <div
        ref={gameAreaRef}
        role="application"
        aria-label="Welding game area. Use arrow keys or WASD to move, Space or Enter to weld."
        tabIndex={0}
        className="relative mb-4 overflow-hidden rounded-2xl border-2 border-white/10 bg-gradient-to-b from-[#374151] to-[#1f2937] select-none focus:outline-none focus:ring-2 focus:ring-[#f97316] focus:ring-offset-2 focus:ring-offset-[#1a1d21]"
        style={{
          width: gameWidth,
          height: gameHeight,
          touchAction: "none",
          WebkitTouchCallout: "none",
          WebkitUserSelect: "none",
          WebkitTapHighlightColor: "transparent",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerLeave}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
      >
        {/* Metal plate texture */}
        <div className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `radial-gradient(circle at 25% 25%, #6b7280 1px, transparent 1px),
                              radial-gradient(circle at 75% 75%, #6b7280 1px, transparent 1px)`,
            backgroundSize: "20px 20px"
          }}
        />

        {/* Crack visualization */}
        {crack && (
          <CrackVisuals
            crack={crack}
            weldProgress={weldProgress}
            spreadProgress={spreadProgress}
            width={gameWidth}
            height={gameHeight}
          />
        )}

        {/* Weld cursor */}
        {isWelding && weldPosition && (
          <div
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: weldPosition.x, top: weldPosition.y }}
            aria-hidden="true"
          >
            {/* Outer glow */}
            <div className="absolute -inset-4 animate-pulse rounded-full bg-[#f97316]/30" />
            {/* Welding torch effect */}
            <div
              className="absolute -inset-2 rounded-full"
              style={{
                background: "radial-gradient(circle, #fef3c7 0%, #fbbf24 30%, #f97316 60%, transparent 70%)",
              }}
            />
            {/* Center spark */}
            <div className="absolute -inset-1 rounded-full bg-white animate-pulse" />
          </div>
        )}

        {/* Touch hint when not welding */}
        {phase === "playing" && !isWelding && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="rounded-full bg-black/40 px-4 py-2 text-sm text-white/60 backdrop-blur-sm">
              Touch & drag to weld
            </div>
          </div>
        )}
      </div>

      {/* Phase indicator */}
      <div className="mb-4 h-12 text-center" aria-live="polite">
        {phase === "playing" && (
          <p className="text-sm text-white/60">
            {isWelding ? (
              <span className="animate-pulse text-[#fbbf24]">Welding...</span>
            ) : (
              "Trace along the crack before it spreads!"
            )}
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
            Cracks Sealed!
          </p>
        )}
      </div>

      {/* Hint */}
      <p className="text-center text-xs text-white/40">
        Drag your finger, use arrow keys, or press <kbd className="rounded bg-white/10 px-1.5 py-0.5">Space</kbd> to weld
      </p>

      {/* Difficulty indicators */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-white/40">
        {difficulty.phase === "night" && (
          <div className="flex items-center gap-1">
            <span className="text-purple-400">🌙</span>
            <span>Night mode: Faster spreading</span>
          </div>
        )}
        {difficulty.rust_level > 0.5 && (
          <div className="flex items-center gap-1">
            <span className="text-orange-400">🔥</span>
            <span>High rust: Tighter precision</span>
          </div>
        )}
      </div>
    </div>
  );
}
