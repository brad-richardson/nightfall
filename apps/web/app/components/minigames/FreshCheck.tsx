"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { MinigameDifficulty } from "../../store";

type FreshCheckProps = {
  config: {
    base_rounds: number;
    max_score: number;
    expected_duration_ms: number;
  };
  difficulty: MinigameDifficulty;
  onComplete: (score: number) => void;
};

type GamePhase = "ready" | "playing" | "result" | "complete" | "fail";

type Ingredient = {
  id: number;
  type: IngredientType;
  isFresh: boolean;
  y: number; // 0-100 vertical position
};

type IngredientType = {
  fresh: { icon: string; name: string };
  spoiled: { icon: string; name: string };
};

const INGREDIENTS: IngredientType[] = [
  { fresh: { icon: "🍎", name: "Apple" }, spoiled: { icon: "🍂", name: "Rotten Apple" } },
  { fresh: { icon: "🥬", name: "Lettuce" }, spoiled: { icon: "🥀", name: "Wilted Lettuce" } },
  { fresh: { icon: "🍞", name: "Bread" }, spoiled: { icon: "🦠", name: "Moldy Bread" } },
  { fresh: { icon: "🥩", name: "Steak" }, spoiled: { icon: "🪰", name: "Bad Meat" } },
  { fresh: { icon: "🧀", name: "Cheese" }, spoiled: { icon: "💀", name: "Rotten Cheese" } },
  { fresh: { icon: "🥛", name: "Milk" }, spoiled: { icon: "🤢", name: "Sour Milk" } },
  { fresh: { icon: "🍌", name: "Banana" }, spoiled: { icon: "🪳", name: "Brown Banana" } },
  { fresh: { icon: "🥚", name: "Egg" }, spoiled: { icon: "💨", name: "Bad Egg" } },
];

// Game zone boundaries
const DROP_ZONE_Y = 85; // Y position where items need to be sorted

export default function FreshCheck({ config, difficulty, onComplete }: FreshCheckProps) {
  const [phase, setPhase] = useState<GamePhase>("ready");
  const [countdown, setCountdown] = useState(3);
  const [currentItem, setCurrentItem] = useState<Ingredient | null>(null);
  const [itemsProcessed, setItemsProcessed] = useState(0);
  const [correctSorts, setCorrectSorts] = useState(0);
  const [score, setScore] = useState(0);
  const [lastResult, setLastResult] = useState<{ correct: boolean; message: string } | null>(null);
  const [swipeDirection, setSwipeDirection] = useState<"left" | "right" | null>(null);

  const animationRef = useRef<number>();
  const lastTimeRef = useRef<number>(0);
  const itemIdRef = useRef(0);
  const scoreRef = useRef(score);
  scoreRef.current = score;

  // Items needed scales with difficulty
  const itemsNeeded = config.base_rounds + difficulty.extra_rounds;

  // Speed scales with difficulty
  const baseSpeed = 25; // units per second at speed_mult = 1
  const speed = baseSpeed * difficulty.speed_mult;

  // Spawn a new ingredient
  const spawnIngredient = useCallback(() => {
    const type = INGREDIENTS[Math.floor(Math.random() * INGREDIENTS.length)];
    // Fresh items more common (60/40 split)
    const isFresh = Math.random() < 0.6;

    itemIdRef.current++;
    setCurrentItem({
      id: itemIdRef.current,
      type,
      isFresh,
      y: 0,
    });
  }, []);

  // Handle swipe/sort
  const handleSort = useCallback((direction: "left" | "right") => {
    if (phase !== "playing" || !currentItem) return;

    setSwipeDirection(direction);

    // Left = discard (spoiled), Right = keep (fresh)
    const sortedAsFresh = direction === "right";
    const isCorrect = sortedAsFresh === currentItem.isFresh;

    const pointsPerItem = Math.round(config.max_score / itemsNeeded);
    const points = isCorrect ? pointsPerItem : 0;

    setScore((s) => s + points);
    if (isCorrect) {
      setCorrectSorts((c) => c + 1);
    }
    setItemsProcessed((p) => p + 1);

    setLastResult({
      correct: isCorrect,
      message: isCorrect
        ? currentItem.isFresh
          ? "Fresh! Good call!"
          : "Tossed the bad one!"
        : currentItem.isFresh
          ? "That was fresh!"
          : "That was spoiled!",
    });

    setPhase("result");

    // After brief result display, continue or complete
    setTimeout(() => {
      setSwipeDirection(null);
      setLastResult(null);

      if (itemsProcessed + 1 >= itemsNeeded) {
        setPhase("complete");
        onComplete(scoreRef.current + points);
      } else {
        spawnIngredient();
        setPhase("playing");
      }
    }, 500);
  }, [phase, currentItem, itemsProcessed, itemsNeeded, config.max_score, onComplete, spawnIngredient]);

  // Animation loop for item falling
  useEffect(() => {
    if (phase !== "playing" || !currentItem) {
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

      setCurrentItem((prev) => {
        if (!prev) return prev;
        const newY = prev.y + speed * delta;

        // If item reaches drop zone without sorting, it's a miss
        if (newY >= DROP_ZONE_Y) {
          // Auto-fail this item
          setTimeout(() => {
            setItemsProcessed((p) => p + 1);
            setLastResult({
              correct: false,
              message: "Too slow!",
            });
            setPhase("result");

            setTimeout(() => {
              setLastResult(null);
              if (itemsProcessed + 1 >= itemsNeeded) {
                setPhase("complete");
                onComplete(scoreRef.current);
              } else {
                spawnIngredient();
                setPhase("playing");
              }
            }, 500);
          }, 0);
          return { ...prev, y: DROP_ZONE_Y };
        }

        return { ...prev, y: newY };
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
  }, [phase, currentItem?.id, speed, itemsProcessed, itemsNeeded, onComplete, spawnIngredient]);

  // Countdown before game starts
  useEffect(() => {
    if (phase !== "ready") return;

    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      spawnIngredient();
      setPhase("playing");
    }
  }, [countdown, phase, spawnIngredient]);

  // Handle keyboard input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
        e.preventDefault();
        handleSort("left");
      } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
        e.preventDefault();
        handleSort("right");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSort]);

  // Touch handling for swipe
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;

    const deltaX = e.changedTouches[0].clientX - touchStartRef.current.x;
    const deltaY = Math.abs(e.changedTouches[0].clientY - touchStartRef.current.y);

    // Require horizontal swipe to be more prominent than vertical
    if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > deltaY) {
      handleSort(deltaX < 0 ? "left" : "right");
    }

    touchStartRef.current = null;
  }, [handleSort]);

  // Render countdown
  if (phase === "ready") {
    return (
      <div className="flex flex-col items-center justify-center">
        <p className="mb-4 text-lg text-white/60">Sort the ingredients!</p>
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[#4ade80]/20 text-5xl font-bold text-[#4ade80]">
          {countdown}
        </div>
        <p className="mt-4 text-sm text-white/40">Get ready...</p>
      </div>
    );
  }

  const accuracy = itemsProcessed > 0 ? Math.round((correctSorts / itemsProcessed) * 100) : 100;

  return (
    <div
      className="flex w-full max-w-md flex-col items-center"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Status bar */}
      <div className="mb-4 flex w-full items-center justify-between text-sm">
        <div className="text-white/60">
          Item <span className="font-bold text-white">{itemsProcessed + 1}</span> / {itemsNeeded}
        </div>
        <div className="text-white/60">
          Score: <span className="font-bold text-[#4ade80]">{score}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-6 h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full bg-gradient-to-r from-[#4ade80] to-[#22c55e] transition-all duration-300"
          style={{ width: `${(itemsProcessed / itemsNeeded) * 100}%` }}
        />
      </div>

      {/* Accuracy display */}
      <div className="mb-4 text-center text-xs text-white/40">
        Accuracy: <span className={accuracy >= 70 ? "text-[#4ade80]" : "text-[#ef4444]"}>{accuracy}%</span>
      </div>

      {/* Conveyor area */}
      <div className="relative mb-4 h-64 w-full overflow-hidden rounded-2xl border-2 border-white/10 bg-gradient-to-b from-[#1a1d21] to-[#2a2d31]">
        {/* Conveyor belt lines */}
        <div className="absolute inset-0 overflow-hidden opacity-20">
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className="absolute left-1/2 h-0.5 w-full -translate-x-1/2 bg-white/30"
              style={{ top: `${(i + 1) * 12}%` }}
            />
          ))}
        </div>

        {/* Sort zone indicators */}
        <div className="absolute bottom-0 left-0 right-0 flex h-16">
          <div className="flex flex-1 items-center justify-center border-r border-white/10 bg-[#ef4444]/10">
            <span className="text-2xl opacity-50">🗑️</span>
          </div>
          <div className="flex flex-1 items-center justify-center bg-[#4ade80]/10">
            <span className="text-2xl opacity-50">✅</span>
          </div>
        </div>

        {/* Current ingredient */}
        {currentItem && (phase === "playing" || phase === "result") && (
          <div
            className={`absolute left-1/2 flex -translate-x-1/2 flex-col items-center transition-all ${
              swipeDirection === "left"
                ? "-translate-x-[200%] rotate-[-30deg] opacity-0"
                : swipeDirection === "right"
                  ? "translate-x-[100%] rotate-[30deg] opacity-0"
                  : ""
            }`}
            style={{
              top: `${currentItem.y}%`,
              transitionDuration: swipeDirection ? "300ms" : "0ms",
            }}
          >
            <div
              className={`flex h-20 w-20 items-center justify-center rounded-2xl border-2 shadow-lg ${
                currentItem.isFresh
                  ? "border-[#4ade80]/30 bg-[#4ade80]/10"
                  : "border-[#ef4444]/30 bg-[#ef4444]/10"
              }`}
            >
              <span className="text-5xl">
                {currentItem.isFresh ? currentItem.type.fresh.icon : currentItem.type.spoiled.icon}
              </span>
            </div>
            <span className="mt-1 text-xs font-medium text-white/60">
              {currentItem.isFresh ? currentItem.type.fresh.name : currentItem.type.spoiled.name}
            </span>
          </div>
        )}

        {/* Result overlay */}
        {lastResult && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <div
              className={`rounded-xl px-6 py-3 text-lg font-bold ${
                lastResult.correct ? "bg-[#4ade80]/20 text-[#4ade80]" : "bg-[#ef4444]/20 text-[#ef4444]"
              }`}
            >
              {lastResult.message}
            </div>
          </div>
        )}

        {/* Complete overlay */}
        {phase === "complete" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <div className="text-center">
              <p className="text-2xl font-bold text-[#4ade80]">Quality Check Complete!</p>
              <p className="mt-2 text-white/60">
                {correctSorts} of {itemsNeeded} sorted correctly
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="mb-4 text-center">
        {phase === "playing" && (
          <p className="text-sm text-white/60">
            <span className="text-[#ef4444]">← Discard spoiled</span>
            {" | "}
            <span className="text-[#4ade80]">Keep fresh →</span>
          </p>
        )}
      </div>

      {/* Control buttons */}
      <div className="flex w-full gap-4">
        <button
          onClick={() => handleSort("left")}
          disabled={phase !== "playing"}
          className={`flex flex-1 flex-col items-center justify-center rounded-xl border-2 py-4 transition-all ${
            phase === "playing"
              ? "border-[#ef4444]/50 bg-[#ef4444]/10 hover:bg-[#ef4444]/20 active:scale-95"
              : "border-white/10 bg-white/5 opacity-50"
          }`}
        >
          <span className="text-2xl">🗑️</span>
          <span className="mt-1 text-xs text-white/60">Spoiled</span>
        </button>
        <button
          onClick={() => handleSort("right")}
          disabled={phase !== "playing"}
          className={`flex flex-1 flex-col items-center justify-center rounded-xl border-2 py-4 transition-all ${
            phase === "playing"
              ? "border-[#4ade80]/50 bg-[#4ade80]/10 hover:bg-[#4ade80]/20 active:scale-95"
              : "border-white/10 bg-white/5 opacity-50"
          }`}
        >
          <span className="text-2xl">✅</span>
          <span className="mt-1 text-xs text-white/60">Fresh</span>
        </button>
      </div>

      {/* Difficulty indicators */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-white/40">
        {difficulty.phase === "night" && (
          <div className="flex items-center gap-1">
            <span className="text-purple-400">🌙</span>
            <span>Night mode: Faster conveyor</span>
          </div>
        )}
        {difficulty.rust_level > 0.5 && (
          <div className="flex items-center gap-1">
            <span className="text-orange-400">🔥</span>
            <span>High rust: More items</span>
          </div>
        )}
      </div>
    </div>
  );
}
