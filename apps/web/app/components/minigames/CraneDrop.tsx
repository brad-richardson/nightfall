"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { MinigameDifficulty } from "../../store";

type CraneDropProps = {
  config: {
    base_rounds: number;
    max_score: number;
    expected_duration_ms: number;
  };
  difficulty: MinigameDifficulty;
  onComplete: (score: number) => void;
};

type GamePhase = "ready" | "moving" | "dropping" | "grabbing" | "returning" | "result" | "complete";

type SalvageItem = {
  id: number;
  name: string;
  emoji: string;
  value: "high" | "medium" | "low" | "junk";
  points: number;
  x: number; // Position as percentage (0-100)
  width: number; // Width as percentage
};

// High value items (100% base points)
const HIGH_VALUE_ITEMS = [
  { name: "Copper Pipes", emoji: "🔧" },
  { name: "Steel Beams", emoji: "🏗️" },
  { name: "Solar Panel", emoji: "☀️" },
  { name: "Generator", emoji: "⚡" },
];

// Medium value items (60% base points)
const MEDIUM_VALUE_ITEMS = [
  { name: "Circuit Board", emoji: "💾" },
  { name: "Tool Set", emoji: "🧰" },
  { name: "Wire Spools", emoji: "🔌" },
  { name: "Metal Sheets", emoji: "🛡️" },
];

// Low value items (30% base points)
const LOW_VALUE_ITEMS = [
  { name: "Scrap Metal", emoji: "⚙️" },
  { name: "Old Pipes", emoji: "🪠" },
  { name: "Used Parts", emoji: "🔩" },
  { name: "Mixed Salvage", emoji: "📦" },
];

// Junk items (0 points, penalty to streak)
const JUNK_ITEMS = [
  { name: "Rust Chunks", emoji: "🧱" },
  { name: "Broken Glass", emoji: "🪟" },
  { name: "Toxic Waste", emoji: "☢️" },
  { name: "Dead Battery", emoji: "🔋" },
];

// Crane movement speed (pixels per frame at 60fps equivalent)
const BASE_CRANE_SPEED = 2.5;
// Drop/return animation duration in ms
const DROP_DURATION_MS = 400;
const GRAB_DURATION_MS = 300;
const RETURN_DURATION_MS = 500;
const RESULT_DURATION_MS = 800;
// Claw width as percentage of play area
const CLAW_WIDTH_PERCENT = 8;

export default function CraneDrop({ config, difficulty, onComplete }: CraneDropProps) {
  const [phase, setPhase] = useState<GamePhase>("ready");
  const [countdown, setCountdown] = useState(3);
  const [round, setRound] = useState(0);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [craneX, setCraneX] = useState(50); // Percentage position
  const [craneDirection, setCraneDirection] = useState<1 | -1>(1);
  const [clawY, setClawY] = useState(0); // 0 = top, 100 = bottom
  const [grabbedItem, setGrabbedItem] = useState<SalvageItem | null>(null);
  const [lastResult, setLastResult] = useState<{ item: SalvageItem | null; points: number } | null>(null);
  const [items, setItems] = useState<SalvageItem[]>([]);

  const mountedRef = useRef(true);
  const scoreRef = useRef(score);
  const animationRef = useRef<number>();

  scoreRef.current = score;

  const totalRounds = config.base_rounds + difficulty.extra_rounds;
  const basePointsPerRound = Math.round(config.max_score / totalRounds);
  const craneSpeed = BASE_CRANE_SPEED * difficulty.speed_mult;

  // Generate items for a round
  const generateItems = useCallback(() => {
    const newItems: SalvageItem[] = [];
    const positions: number[] = [];

    // Always have 1-2 high value, 1-2 medium, 1-2 low, and 1-2 junk
    const itemCounts = {
      high: Math.random() > 0.5 ? 1 : 2,
      medium: Math.random() > 0.5 ? 1 : 2,
      low: Math.random() > 0.5 ? 1 : 2,
      junk: Math.random() > 0.5 ? 1 : 2,
    };

    let id = 0;

    const addItems = (
      pool: { name: string; emoji: string }[],
      value: SalvageItem["value"],
      count: number,
      pointMultiplier: number
    ) => {
      for (let i = 0; i < count; i++) {
        const template = pool[Math.floor(Math.random() * pool.length)];
        // Find a non-overlapping position
        let x: number;
        let attempts = 0;
        const itemWidth = value === "high" ? 12 : value === "medium" ? 10 : 8;
        do {
          x = 5 + Math.random() * (90 - itemWidth);
          attempts++;
        } while (
          attempts < 20 &&
          positions.some((pos) => Math.abs(pos - x) < itemWidth + 2)
        );
        positions.push(x);

        newItems.push({
          id: id++,
          name: template.name,
          emoji: template.emoji,
          value,
          points: Math.round(basePointsPerRound * pointMultiplier),
          x,
          width: itemWidth,
        });
      }
    };

    addItems(HIGH_VALUE_ITEMS, "high", itemCounts.high, 1.0);
    addItems(MEDIUM_VALUE_ITEMS, "medium", itemCounts.medium, 0.6);
    addItems(LOW_VALUE_ITEMS, "low", itemCounts.low, 0.3);
    addItems(JUNK_ITEMS, "junk", itemCounts.junk, 0);

    return newItems;
  }, [basePointsPerRound]);

  // Track mounted state
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  // Countdown before game starts
  useEffect(() => {
    if (phase !== "ready") return;

    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      setItems(generateItems());
      setPhase("moving");
    }
  }, [countdown, phase, generateItems]);

  // Crane movement animation
  useEffect(() => {
    if (phase !== "moving") return;

    let lastTime = performance.now();

    const animate = (currentTime: number) => {
      if (!mountedRef.current || phase !== "moving") return;

      const deltaTime = currentTime - lastTime;
      lastTime = currentTime;

      // Move crane (adjust for frame rate)
      const movement = (craneSpeed * deltaTime) / 16.67; // Normalize to 60fps

      setCraneX((prev) => {
        let newX = prev + movement * craneDirection;

        // Bounce off edges
        if (newX >= 92) {
          newX = 92;
          setCraneDirection(-1);
        } else if (newX <= 8) {
          newX = 8;
          setCraneDirection(1);
        }

        return newX;
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [phase, craneSpeed, craneDirection]);

  // Handle drop action
  const handleDrop = useCallback(() => {
    if (phase !== "moving") return;

    setPhase("dropping");
    setClawY(0);

    // Animate claw dropping
    const dropStart = performance.now();

    const animateDrop = (currentTime: number) => {
      if (!mountedRef.current) return;

      const elapsed = currentTime - dropStart;
      const progress = Math.min(elapsed / DROP_DURATION_MS, 1);

      // Ease out for natural drop feel
      const easeOut = 1 - Math.pow(1 - progress, 2);
      setClawY(easeOut * 100);

      if (progress < 1) {
        requestAnimationFrame(animateDrop);
      } else {
        // Check what we grabbed
        const clawCenter = craneX;
        const clawLeft = clawCenter - CLAW_WIDTH_PERCENT / 2;
        const clawRight = clawCenter + CLAW_WIDTH_PERCENT / 2;

        // Find item under claw (prioritize center hits)
        let grabbed: SalvageItem | null = null;
        let bestOverlap = 0;

        for (const item of items) {
          const itemLeft = item.x;
          const itemRight = item.x + item.width;

          // Calculate overlap
          const overlapLeft = Math.max(clawLeft, itemLeft);
          const overlapRight = Math.min(clawRight, itemRight);
          const overlap = Math.max(0, overlapRight - overlapLeft);

          if (overlap > bestOverlap) {
            bestOverlap = overlap;
            grabbed = item;
          }
        }

        setGrabbedItem(grabbed);
        setPhase("grabbing");

        // After grab pause, return up
        setTimeout(() => {
          if (!mountedRef.current) return;
          setPhase("returning");

          const returnStart = performance.now();

          const animateReturn = (time: number) => {
            if (!mountedRef.current) return;

            const returnElapsed = time - returnStart;
            const returnProgress = Math.min(returnElapsed / RETURN_DURATION_MS, 1);

            // Ease in-out for smooth return
            const easeInOut =
              returnProgress < 0.5
                ? 2 * returnProgress * returnProgress
                : 1 - Math.pow(-2 * returnProgress + 2, 2) / 2;

            setClawY(100 * (1 - easeInOut));

            if (returnProgress < 1) {
              requestAnimationFrame(animateReturn);
            } else {
              // Calculate score
              let points = 0;
              if (grabbed) {
                points = grabbed.points;

                // Streak bonus for valuable items
                if (grabbed.value !== "junk") {
                  const streakBonus = Math.min(streak * 0.1, 0.5);
                  points = Math.round(points * (1 + streakBonus));
                  setStreak((s) => s + 1);
                } else {
                  // Junk breaks streak
                  setStreak(0);
                }

                // Remove grabbed item from pile
                setItems((prev) => prev.filter((i) => i.id !== grabbed.id));
              }

              setScore((s) => s + points);
              setLastResult({ item: grabbed, points });
              setPhase("result");

              // Show result then proceed
              setTimeout(() => {
                if (!mountedRef.current) return;

                const nextRound = round + 1;
                setRound(nextRound);

                if (nextRound >= totalRounds) {
                  setPhase("complete");
                  onComplete(scoreRef.current + points);
                } else {
                  // Reset for next round
                  setGrabbedItem(null);
                  setLastResult(null);
                  setClawY(0);
                  setItems(generateItems());
                  // Randomize starting direction
                  setCraneDirection(Math.random() > 0.5 ? 1 : -1);
                  setPhase("moving");
                }
              }, RESULT_DURATION_MS);
            }
          };

          requestAnimationFrame(animateReturn);
        }, GRAB_DURATION_MS);
      }
    };

    requestAnimationFrame(animateDrop);
  }, [phase, craneX, items, round, totalRounds, streak, onComplete, generateItems]);

  // Keyboard and click controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        handleDrop();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleDrop]);

  // Get color based on item value
  const getItemColor = (value: SalvageItem["value"]) => {
    switch (value) {
      case "high":
        return "from-yellow-400 to-amber-500";
      case "medium":
        return "from-blue-400 to-cyan-500";
      case "low":
        return "from-slate-400 to-slate-500";
      case "junk":
        return "from-red-400 to-red-600";
    }
  };

  const getItemGlow = (value: SalvageItem["value"]) => {
    switch (value) {
      case "high":
        return "shadow-[0_0_20px_rgba(251,191,36,0.5)]";
      case "medium":
        return "shadow-[0_0_15px_rgba(59,130,246,0.4)]";
      case "low":
        return "";
      case "junk":
        return "";
    }
  };

  // Render countdown
  if (phase === "ready") {
    return (
      <div className="flex flex-col items-center justify-center">
        <p className="mb-4 text-center text-lg text-white/60">
          Press <span className="text-[#a78bfa] font-bold">SPACE</span> or <span className="text-[#a78bfa] font-bold">TAP</span> to drop the claw
          <br />
          <span className="text-yellow-400">Gold items</span> are worth the most!
        </p>
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
      <div className="mb-4 flex w-full items-center justify-between text-sm">
        <div className="text-white/60">
          Round <span className="font-bold text-white">{round + 1}</span> / {totalRounds}
        </div>
        <div className="flex items-center gap-4">
          {streak > 1 && (
            <div className="text-orange-400">
              🔥 x{streak}
            </div>
          )}
          <div className="text-white/60">
            Score: <span className="font-bold text-[#a78bfa]">{score}</span>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full bg-gradient-to-r from-[#a78bfa] to-[#818cf8] transition-all duration-300"
          style={{ width: `${(round / totalRounds) * 100}%` }}
        />
      </div>

      {/* Game area */}
      <div
        className="relative mb-6 h-72 w-full cursor-pointer overflow-hidden rounded-2xl border-2 border-white/10 bg-gradient-to-b from-slate-900 to-slate-950"
        onClick={handleDrop}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            handleDrop();
          }
        }}
        aria-label="Drop the claw"
      >
        {/* Crane rail at top */}
        <div className="absolute left-0 right-0 top-0 h-3 bg-gradient-to-b from-slate-600 to-slate-700 shadow-md" />

        {/* Crane arm and claw */}
        <div
          className="absolute top-3 z-10 flex flex-col items-center transition-none"
          style={{
            left: `${craneX}%`,
            transform: "translateX(-50%)",
          }}
        >
          {/* Cable */}
          <div
            className="w-0.5 bg-gradient-to-b from-slate-400 to-slate-500"
            style={{ height: `${clawY * 2}px` }}
          />

          {/* Claw */}
          <div
            className={`relative flex items-center justify-center transition-transform ${
              phase === "grabbing" ? "scale-90" : "scale-100"
            }`}
          >
            {/* Claw arms */}
            <div className="flex items-end">
              <div
                className={`h-6 w-2 origin-top rounded-b-lg bg-gradient-to-b from-amber-500 to-amber-600 transition-transform ${
                  phase === "grabbing" || grabbedItem ? "rotate-12" : "-rotate-12"
                }`}
              />
              <div className="h-4 w-3 rounded-t-lg bg-gradient-to-b from-amber-400 to-amber-500" />
              <div
                className={`h-6 w-2 origin-top rounded-b-lg bg-gradient-to-b from-amber-500 to-amber-600 transition-transform ${
                  phase === "grabbing" || grabbedItem ? "-rotate-12" : "rotate-12"
                }`}
              />
            </div>

            {/* Grabbed item shown in claw */}
            {grabbedItem && phase !== "dropping" && (
              <div className="absolute top-6 text-2xl animate-bounce">
                {grabbedItem.emoji}
              </div>
            )}
          </div>
        </div>

        {/* Items at bottom */}
        <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-slate-800/80 to-transparent">
          {items.map((item) => (
            <div
              key={item.id}
              className={`absolute bottom-2 flex flex-col items-center transition-all ${
                grabbedItem?.id === item.id ? "opacity-0 scale-75" : "opacity-100"
              }`}
              style={{
                left: `${item.x}%`,
                width: `${item.width}%`,
              }}
            >
              <div
                className={`flex h-14 w-full items-center justify-center rounded-lg bg-gradient-to-b ${getItemColor(
                  item.value
                )} ${getItemGlow(item.value)}`}
              >
                <span className="text-2xl">{item.emoji}</span>
              </div>
              <span className="mt-1 text-[10px] text-white/50 truncate w-full text-center">
                {item.name}
              </span>
            </div>
          ))}
        </div>

        {/* Result overlay */}
        {phase === "result" && lastResult && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <div
              className={`flex flex-col items-center rounded-2xl p-6 ${
                lastResult.item
                  ? lastResult.item.value === "junk"
                    ? "text-red-400"
                    : "text-green-400"
                  : "text-white/60"
              }`}
            >
              {lastResult.item ? (
                <>
                  <span className="text-5xl mb-2">{lastResult.item.emoji}</span>
                  <span className="text-xl font-bold">{lastResult.item.name}</span>
                  {lastResult.item.value === "junk" ? (
                    <span className="text-lg mt-1">Junk! 🗑️</span>
                  ) : (
                    <span className="text-lg mt-1">+{lastResult.points} pts</span>
                  )}
                </>
              ) : (
                <>
                  <span className="text-5xl mb-2">💨</span>
                  <span className="text-xl font-bold">Missed!</span>
                  <span className="text-lg mt-1">Nothing grabbed</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Target indicator when moving */}
        {phase === "moving" && (
          <div
            className="absolute top-12 h-48 w-0.5 bg-white/10"
            style={{
              left: `${craneX}%`,
              transform: "translateX(-50%)",
            }}
          />
        )}
      </div>

      {/* Instructions */}
      <div className="mb-4 h-8 text-center">
        {phase === "moving" && (
          <p className="text-sm text-white/60">
            Tap or press SPACE to drop!
          </p>
        )}
        {(phase === "dropping" || phase === "grabbing" || phase === "returning") && (
          <p className="text-sm text-yellow-400 animate-pulse">
            {phase === "dropping" ? "Dropping..." : phase === "grabbing" ? "Grabbing!" : "Returning..."}
          </p>
        )}
        {phase === "complete" && (
          <p className="text-xl font-bold text-[#4ade80]">
            Complete!
          </p>
        )}
      </div>

      {/* Drop button for mobile */}
      <button
        onClick={handleDrop}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleDrop();
          }
        }}
        disabled={phase !== "moving"}
        className={`flex h-20 w-20 items-center justify-center rounded-full border-4 text-4xl transition-all ${
          phase === "moving"
            ? "border-[#a78bfa] bg-[#a78bfa]/20 hover:bg-[#a78bfa]/30 active:scale-95 animate-pulse"
            : "border-white/20 bg-white/5"
        }`}
        aria-label="Drop claw"
      >
        🪝
      </button>

      {/* Difficulty indicators */}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs text-white/40">
        {difficulty.phase === "night" && (
          <div className="flex items-center gap-1">
            <span className="text-purple-400">🌙</span>
            <span>Night mode: Faster crane</span>
          </div>
        )}
        {difficulty.rust_level > 0.5 && (
          <div className="flex items-center gap-1">
            <span className="text-orange-400">🔥</span>
            <span>High rust: Extra speed</span>
          </div>
        )}
      </div>
    </div>
  );
}
