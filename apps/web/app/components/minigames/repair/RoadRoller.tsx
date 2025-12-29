"use client";

import { useState, useEffect, useCallback, useRef, useMemo, memo } from "react";
import type { MinigameDifficulty } from "../../../store";

type RoadRollerProps = {
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

type RoadPath = {
  points: Point[];
  controlPoints: Point[];
  length: number;
};

// Zone thresholds (distance from path in pixels)
const PERFECT_ZONE = 15;
const GREAT_ZONE = 25;
const GOOD_ZONE = 40;

// Path generation constants
const PATH_MARGIN = 50;
const PATH_WIDTH = 60;
const ROLLER_SIZE = 40;

// Game constants
const BASE_SPEED = 0.15;
const RESULT_DISPLAY_MS = 700;

// Generate road path for a round
function generateRoadPath(width: number, height: number): RoadPath {
  const points: Point[] = [];
  const controlPoints: Point[] = [];

  // Start from left side
  const startY = height / 2 + (Math.random() - 0.5) * (height - PATH_MARGIN * 2) * 0.5;
  points.push({ x: PATH_MARGIN, y: startY });

  // Generate 3-4 intermediate waypoints
  const numWaypoints = 3 + Math.floor(Math.random() * 2);
  for (let i = 1; i <= numWaypoints; i++) {
    const t = i / (numWaypoints + 1);
    const baseX = PATH_MARGIN + (width - PATH_MARGIN * 2) * t;
    const baseY = height / 2 + (Math.random() - 0.5) * (height - PATH_MARGIN * 2) * 0.6;
    points.push({
      x: Math.max(PATH_MARGIN, Math.min(width - PATH_MARGIN, baseX)),
      y: Math.max(PATH_MARGIN, Math.min(height - PATH_MARGIN, baseY)),
    });
  }

  // End at right side
  const endY = height / 2 + (Math.random() - 0.5) * (height - PATH_MARGIN * 2) * 0.5;
  points.push({ x: width - PATH_MARGIN, y: endY });

  // Generate control points for smooth curves
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    controlPoints.push({
      x: midX + (Math.random() - 0.5) * 30,
      y: midY + (Math.random() - 0.5) * 30,
    });
  }

  // Calculate path length
  let length = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    length += Math.sqrt(dx * dx + dy * dy);
  }

  return { points, controlPoints, length };
}

// Get point on path at progress (0-1)
function getPointOnPath(path: RoadPath, progress: number): Point {
  const totalSegments = path.points.length - 1;
  const segmentProgress = progress * totalSegments;
  const segmentIndex = Math.min(Math.floor(segmentProgress), totalSegments - 1);
  const t = segmentProgress - segmentIndex;

  const p1 = path.points[segmentIndex];
  const p2 = path.points[segmentIndex + 1];
  const cp = path.controlPoints[segmentIndex];

  // Quadratic bezier interpolation
  const x = (1 - t) * (1 - t) * p1.x + 2 * (1 - t) * t * cp.x + t * t * p2.x;
  const y = (1 - t) * (1 - t) * p1.y + 2 * (1 - t) * t * cp.y + t * t * p2.y;

  return { x, y };
}

// Generate SVG path string
function getPathString(path: RoadPath): string {
  if (path.points.length < 2) return "";

  let d = `M ${path.points[0].x} ${path.points[0].y}`;

  for (let i = 0; i < path.points.length - 1; i++) {
    const cp = path.controlPoints[i];
    const end = path.points[i + 1];
    d += ` Q ${cp.x} ${cp.y} ${end.x} ${end.y}`;
  }

  return d;
}

// Calculate distance from point to path
function getDistanceToPath(path: RoadPath, point: Point, resolution = 50): number {
  let minDist = Infinity;

  for (let i = 0; i <= resolution; i++) {
    const progress = i / resolution;
    const pathPoint = getPointOnPath(path, progress);
    const dx = point.x - pathPoint.x;
    const dy = point.y - pathPoint.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < minDist) {
      minDist = dist;
    }
  }

  return minDist;
}

// Road visualization
const RoadVisuals = memo(function RoadVisuals({
  path,
  rolledProgress,
  width,
  height,
}: {
  path: RoadPath;
  rolledProgress: number;
  width: number;
  height: number;
}) {
  const pathString = useMemo(() => getPathString(path), [path]);

  return (
    <svg width={width} height={height} className="absolute inset-0" aria-hidden="true">
      <defs>
        <filter id="roadShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.3" />
        </filter>
        <linearGradient id="roadGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#4b5563" />
          <stop offset="100%" stopColor="#374151" />
        </linearGradient>
        <linearGradient id="rolledGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#1f2937" />
          <stop offset="100%" stopColor="#111827" />
        </linearGradient>
      </defs>

      {/* Road base */}
      <path
        d={pathString}
        fill="none"
        stroke="url(#roadGradient)"
        strokeWidth={PATH_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
        filter="url(#roadShadow)"
      />

      {/* Road markings */}
      <path
        d={pathString}
        fill="none"
        stroke="#fbbf24"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray="10 20"
        opacity={0.4}
      />

      {/* Rolled portion (smoother, darker) */}
      <path
        d={pathString}
        fill="none"
        stroke="url(#rolledGradient)"
        strokeWidth={PATH_WIDTH - 10}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={path.length}
        strokeDashoffset={path.length * (1 - rolledProgress)}
      />

      {/* Rolled shine effect */}
      <path
        d={pathString}
        fill="none"
        stroke="rgba(255,255,255,0.1)"
        strokeWidth={4}
        strokeLinecap="round"
        strokeDasharray={path.length}
        strokeDashoffset={path.length * (1 - rolledProgress)}
      />
    </svg>
  );
});

export default function RoadRoller({ config, difficulty, onComplete }: RoadRollerProps) {
  const [phase, setPhase] = useState<GamePhase>("ready");
  const [countdown, setCountdown] = useState(3);
  const [currentRound, setCurrentRound] = useState(0);
  const [score, setScore] = useState(0);
  const [lastResult, setLastResult] = useState<{ zone: string; points: number; color: string } | null>(null);

  // Road state
  const [path, setPath] = useState<RoadPath | null>(null);
  const [rollerProgress, setRollerProgress] = useState(0);
  const [rollerPosition, setRollerPosition] = useState<Point | null>(null);
  const [isRolling, setIsRolling] = useState(false);

  const gameAreaRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>();
  const lastTimeRef = useRef<number>(0);
  const scoreRef = useRef(score);
  const resultTimeoutRef = useRef<NodeJS.Timeout>();

  // Accuracy tracking
  const accuracySumRef = useRef(0);
  const accuracyCountRef = useRef(0);

  scoreRef.current = score;

  const gameWidth = 320;
  const gameHeight = 280;
  const roundsNeeded = config.base_rounds;
  const rollSpeed = BASE_SPEED * difficulty.speed_mult;

  // Generate new road for round
  const generateNewRoad = useCallback(() => {
    const newPath = generateRoadPath(gameWidth, gameHeight);
    setPath(newPath);
    setRollerProgress(0);
    setRollerPosition(null);
    accuracySumRef.current = 0;
    accuracyCountRef.current = 0;
  }, []);

  // Points calculation
  const getRoundPoints = useCallback(
    (avgAccuracy: number) => {
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
        return { zone: "OFF ROAD", points: Math.round(roundPoints * 0.1), color: "#ef4444" };
      }
    },
    [config.max_score, roundsNeeded, difficulty.window_mult]
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
          generateNewRoad();
          setLastResult(null);
          setPhase("playing");
        }
      }, RESULT_DISPLAY_MS);
    },
    [currentRound, roundsNeeded, generateNewRoad, onComplete]
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
      generateNewRoad();
      setPhase("playing");
    }
  }, [countdown, phase, generateNewRoad]);

  // Game loop
  useEffect(() => {
    if (phase !== "playing" || !path) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      return;
    }

    let roundComplete = false;

    const animate = (time: number) => {
      if (roundComplete) return;

      if (lastTimeRef.current === 0) {
        lastTimeRef.current = time;
      }

      const delta = (time - lastTimeRef.current) / 1000;
      lastTimeRef.current = time;

      // Roll forward when active and on target
      if (isRolling && rollerPosition) {
        const distance = getDistanceToPath(path, rollerPosition);

        // Apply difficulty scaling to zone thresholds
        const perfectZone = PERFECT_ZONE * difficulty.window_mult;
        const greatZone = GREAT_ZONE * difficulty.window_mult;
        const goodZone = GOOD_ZONE * difficulty.window_mult;

        // Only roll if close enough to the path
        if (distance < goodZone) {
          const speedMultiplier = distance < perfectZone ? 1.0 : distance < greatZone ? 0.8 : 0.6;

          setRollerProgress((prev) => {
            const newProgress = Math.min(1, prev + rollSpeed * speedMultiplier * delta);

            // Track accuracy
            accuracySumRef.current += distance;
            accuracyCountRef.current += 1;

            // Check completion
            if (!roundComplete && newProgress >= 0.98) {
              roundComplete = true;
              const avgAccuracy =
                accuracyCountRef.current > 0
                  ? accuracySumRef.current / accuracyCountRef.current
                  : GOOD_ZONE;
              const result = getRoundPoints(avgAccuracy);
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
  }, [phase, path, isRolling, rollerPosition, rollSpeed, difficulty.window_mult, getRoundPoints, handleRoundComplete]);

  // Handle pointer events
  const getRelativePosition = useCallback((clientX: number, clientY: number): Point | null => {
    if (!gameAreaRef.current) return null;
    const rect = gameAreaRef.current.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (phase !== "playing") return;
      e.preventDefault();
      const pos = getRelativePosition(e.clientX, e.clientY);
      if (pos) {
        setIsRolling(true);
        setRollerPosition(pos);
      }
    },
    [phase, getRelativePosition]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isRolling || phase !== "playing") return;
      e.preventDefault();
      const pos = getRelativePosition(e.clientX, e.clientY);
      if (pos) {
        setRollerPosition(pos);
      }
    },
    [isRolling, phase, getRelativePosition]
  );

  const handlePointerUp = useCallback(() => {
    setIsRolling(false);
  }, []);

  // Keyboard controls for accessibility
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (phase !== "playing" || !path) return;

      const step = 10;
      let newX = rollerPosition?.x ?? gameWidth / 2;
      let newY = rollerPosition?.y ?? gameHeight / 2;

      switch (e.key) {
        case "ArrowUp":
        case "w":
        case "W":
          e.preventDefault();
          newY = Math.max(0, newY - step);
          break;
        case "ArrowDown":
        case "s":
        case "S":
          e.preventDefault();
          newY = Math.min(gameHeight, newY + step);
          break;
        case "ArrowLeft":
        case "a":
        case "A":
          e.preventDefault();
          newX = Math.max(0, newX - step);
          break;
        case "ArrowRight":
        case "d":
        case "D":
          e.preventDefault();
          newX = Math.min(gameWidth, newX + step);
          break;
        case " ":
        case "Enter":
          e.preventDefault();
          setIsRolling(!isRolling);
          return;
        default:
          return;
      }

      setRollerPosition({ x: newX, y: newY });
      if (!isRolling) {
        setIsRolling(true);
      }
    },
    [phase, path, rollerPosition, isRolling, gameWidth, gameHeight]
  );

  // Render countdown
  if (phase === "ready") {
    return (
      <div className="flex flex-col items-center justify-center">
        <p className="mb-4 text-lg text-white/60">Guide the roller along the road!</p>
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-amber-500/20 text-5xl font-bold text-amber-400">
          {countdown}
        </div>
        <p className="mt-4 text-sm text-white/40">Get ready...</p>
      </div>
    );
  }

  const rollPercent = Math.round(rollerProgress * 100);

  return (
    <div className="flex w-full max-w-md flex-col items-center">
      {/* Status bar */}
      <div className="mb-4 flex w-full items-center justify-between text-sm">
        <div className="text-white/60">
          Road <span className="font-bold text-white">{currentRound + 1}</span> / {roundsNeeded}
        </div>
        <div className="text-white/60">
          Score: <span className="font-bold text-amber-400">{score}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-4 w-full">
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="text-white/40">Rolled</span>
          <span className="text-amber-400">{rollPercent}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full bg-gradient-to-r from-amber-500 to-green-500 transition-all duration-100"
            style={{ width: `${rollPercent}%` }}
          />
        </div>
      </div>

      {/* Game area */}
      <div
        ref={gameAreaRef}
        className="relative mb-4 overflow-hidden rounded-2xl border-2 border-white/10 bg-gradient-to-b from-green-900/50 to-green-950/50 focus:outline-none focus:ring-2 focus:ring-amber-400/50"
        style={{ width: gameWidth, height: gameHeight, touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="application"
        aria-label="Road roller game area. Use arrow keys or WASD to move the roller, Space or Enter to toggle rolling."
      >
        {/* Grass texture */}
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `radial-gradient(circle at 30% 40%, #22c55e 1px, transparent 1px),
                              radial-gradient(circle at 70% 60%, #22c55e 1px, transparent 1px)`,
            backgroundSize: "15px 15px",
          }}
        />

        {/* Road */}
        {path && (
          <RoadVisuals
            path={path}
            rolledProgress={rollerProgress}
            width={gameWidth}
            height={gameHeight}
          />
        )}

        {/* Roller cursor */}
        {isRolling && rollerPosition && (
          <div
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: rollerPosition.x, top: rollerPosition.y }}
          >
            {/* Roller body */}
            <div
              className="flex items-center justify-center rounded-lg bg-gradient-to-b from-amber-400 to-amber-600 shadow-lg"
              style={{ width: ROLLER_SIZE, height: ROLLER_SIZE * 0.6 }}
            >
              {/* Roller drum */}
              <div className="h-full w-3/4 rounded-lg bg-gradient-to-r from-gray-600 to-gray-400" />
            </div>
            {/* Ground effect */}
            <div
              className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-black/30 blur-sm"
              style={{ width: ROLLER_SIZE - 8, height: 6 }}
            />
          </div>
        )}

        {/* Touch hint */}
        {phase === "playing" && !isRolling && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="rounded-full bg-black/40 px-4 py-2 text-center text-sm text-white/60 backdrop-blur-sm">
              <p>Touch & drag the roller</p>
              <p className="text-xs">or use arrow keys / WASD</p>
            </div>
          </div>
        )}
      </div>

      {/* Phase indicator */}
      <div className="mb-4 h-12 text-center" aria-live="polite">
        {phase === "playing" && (
          <p className="text-sm text-white/60">
            {isRolling ? (
              <span className="animate-pulse text-amber-400">Rolling...</span>
            ) : (
              "Drag along the road to smooth it!"
            )}
          </p>
        )}
        {phase === "result" && lastResult && (
          <div className="flex flex-col items-center">
            <p className="text-2xl font-bold" style={{ color: lastResult.color }}>
              {lastResult.zone}
            </p>
            <p className="text-sm text-white/60">+{lastResult.points} points</p>
          </div>
        )}
        {phase === "complete" && (
          <p className="text-xl font-bold text-green-400">Road Smoothed!</p>
        )}
      </div>

      {/* Difficulty indicators */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-white/40">
        {difficulty.phase === "night" && (
          <div className="flex items-center gap-1">
            <span className="text-purple-400">🌙</span>
            <span>Night mode: Faster rolling</span>
          </div>
        )}
      </div>
    </div>
  );
}
