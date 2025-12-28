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

type GamePhase = "ready" | "playing" | "feedback" | "complete";

type SalvageItem = {
  id: number;
  name: string;
  emoji: string;
  isValuable: boolean;
  description: string;
};

// Pool of salvage items - valuable ones to keep, junk to discard
const VALUABLE_ITEMS: Omit<SalvageItem, "id" | "isValuable">[] = [
  { name: "Copper Pipes", emoji: "🔧", description: "Clean, reusable pipes" },
  { name: "Steel Beams", emoji: "🏗️", description: "Solid structural steel" },
  { name: "Circuit Board", emoji: "💾", description: "Working electronics" },
  { name: "Solar Panel", emoji: "☀️", description: "Functional power source" },
  { name: "Clean Water Tank", emoji: "💧", description: "Intact storage" },
  { name: "Generator Parts", emoji: "⚡", description: "Usable components" },
  { name: "Tool Set", emoji: "🧰", description: "Quality hand tools" },
  { name: "Metal Sheets", emoji: "🛡️", description: "Unbent metal" },
  { name: "Wire Spools", emoji: "🔌", description: "Copper wiring" },
  { name: "Gears", emoji: "⚙️", description: "Precision parts" },
];

const JUNK_ITEMS: Omit<SalvageItem, "id" | "isValuable">[] = [
  { name: "Rusted Pipes", emoji: "🪠", description: "Corroded beyond use" },
  { name: "Cracked Glass", emoji: "🪟", description: "Shattered fragments" },
  { name: "Burnt Wires", emoji: "💥", description: "Fire damaged" },
  { name: "Moldy Wood", emoji: "🪵", description: "Rotting timber" },
  { name: "Leaky Container", emoji: "🛢️", description: "Holes everywhere" },
  { name: "Broken Screen", emoji: "📺", description: "Smashed display" },
  { name: "Contaminated Soil", emoji: "🧪", description: "Toxic waste" },
  { name: "Bent Rebar", emoji: "🦴", description: "Unusable shape" },
  { name: "Dead Battery", emoji: "🔋", description: "No charge left" },
  { name: "Rust Chunks", emoji: "🧱", description: "Pure corrosion" },
];

// Swipe threshold in pixels
const SWIPE_THRESHOLD = 80;
// Card exit animation distance in pixels
const CARD_EXIT_DISTANCE = 300;
// Card rotation multiplier (degrees per pixel of offset)
const CARD_ROTATION_FACTOR = 0.05;
// Card opacity fade distance
const CARD_OPACITY_FADE_DISTANCE = 400;
// Timer update interval in milliseconds
const TIMER_INTERVAL_MS = 200;
// Maximum speed bonus multiplier (50% bonus for instant answers)
const MAX_SPEED_BONUS = 0.5;
// Maximum streak bonus multiplier (50% bonus at 5+ streak)
const MAX_STREAK_BONUS = 0.5;
// Streak bonus increment per correct answer
const STREAK_BONUS_INCREMENT = 0.1;

export default function SalvageRun({ config, difficulty, onComplete }: SalvageRunProps) {
  const [phase, setPhase] = useState<GamePhase>("ready");
  const [countdown, setCountdown] = useState(3);
  const [currentItem, setCurrentItem] = useState<SalvageItem | null>(null);
  const [itemsCompleted, setItemsCompleted] = useState(0);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [feedback, setFeedback] = useState<{ correct: boolean; points: number; direction: "left" | "right" } | null>(null);
  const [cardOffset, setCardOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);

  const dragStartRef = useRef(0);
  const mountedRef = useRef(true);
  const scoreRef = useRef(score);
  const itemQueueRef = useRef<SalvageItem[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const currentItemRef = useRef(currentItem);
  const handleChoiceRef = useRef<(direction: "left" | "right", timedOut?: boolean) => void>(() => {});

  scoreRef.current = score;
  currentItemRef.current = currentItem;

  // Total items to sort
  const totalItems = config.base_rounds + difficulty.extra_rounds;

  // Time per item decreases with difficulty (in seconds)
  const baseTimePerItem = 3;
  const timePerItem = Math.max(1.5, baseTimePerItem / difficulty.speed_mult);

  // Generate queue of items to sort
  const generateItemQueue = useCallback(() => {
    const items: SalvageItem[] = [];
    const valuableCount = Math.floor(totalItems * 0.5); // 50% valuable
    const junkCount = totalItems - valuableCount;

    // Add valuable items
    for (let i = 0; i < valuableCount; i++) {
      const template = VALUABLE_ITEMS[Math.floor(Math.random() * VALUABLE_ITEMS.length)];
      items.push({ ...template, id: i, isValuable: true });
    }

    // Add junk items
    for (let i = 0; i < junkCount; i++) {
      const template = JUNK_ITEMS[Math.floor(Math.random() * JUNK_ITEMS.length)];
      items.push({ ...template, id: valuableCount + i, isValuable: false });
    }

    // Shuffle
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }

    return items;
  }, [totalItems]);

  // Track mounted state
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
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
      // Start the game
      itemQueueRef.current = generateItemQueue();
      setCurrentItem(itemQueueRef.current[0]);
      setTimeLeft(timePerItem);
      setPhase("playing");
    }
  }, [countdown, phase, generateItemQueue, timePerItem]);

  // Handle player choice
  const handleChoice = useCallback((direction: "left" | "right", timedOut = false) => {
    if (phase !== "playing" || !currentItem) return;

    // Left = Keep (valuable), Right = Discard (junk)
    const playerKeeps = direction === "left";
    const correct = playerKeeps === currentItem.isValuable;

    // Calculate points
    const basePoints = Math.round(config.max_score / totalItems);
    let points = 0;

    if (correct && !timedOut) {
      // Bonus for speed (more time left = more points)
      const speedBonus = 1 + (timeLeft / timePerItem) * MAX_SPEED_BONUS;
      // Streak bonus
      const streakBonus = 1 + Math.min(streak * STREAK_BONUS_INCREMENT, MAX_STREAK_BONUS);
      points = Math.round(basePoints * speedBonus * streakBonus);
      setStreak((s) => s + 1);
    } else {
      setStreak(0);
    }

    setScore((s) => s + points);
    setFeedback({ correct, points, direction });
    setCardOffset(direction === "left" ? -CARD_EXIT_DISTANCE : CARD_EXIT_DISTANCE);
    setPhase("feedback");

    // Move to next item
    setTimeout(() => {
      if (!mountedRef.current) return;

      const nextIndex = itemsCompleted + 1;
      setItemsCompleted(nextIndex);

      if (nextIndex >= totalItems) {
        setPhase("complete");
        onComplete(scoreRef.current + points);
      } else {
        setCurrentItem(itemQueueRef.current[nextIndex]);
        setCardOffset(0);
        setTimeLeft(timePerItem);
        setFeedback(null);
        setPhase("playing");
      }
    }, 400);
  }, [phase, currentItem, itemsCompleted, totalItems, config.max_score, timeLeft, timePerItem, streak, onComplete]);

  // Keep ref updated for use in timer
  handleChoiceRef.current = handleChoice;

  // Timer countdown during play
  useEffect(() => {
    if (phase !== "playing") {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      return;
    }

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        const decrement = TIMER_INTERVAL_MS / 1000;
        if (prev <= decrement) {
          // Time's up - count as wrong answer
          const item = currentItemRef.current;
          handleChoiceRef.current(item?.isValuable ? "right" : "left", true);
          return 0;
        }
        return prev - decrement;
      });
    }, TIMER_INTERVAL_MS);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [phase]);

  // Mouse/touch handlers for swiping
  const handleDragStart = useCallback((clientX: number) => {
    if (phase !== "playing") return;
    setIsDragging(true);
    dragStartRef.current = clientX;
  }, [phase]);

  const handleDragMove = useCallback((clientX: number) => {
    if (!isDragging || phase !== "playing") return;
    const delta = clientX - dragStartRef.current;
    setCardOffset(delta);
  }, [isDragging, phase]);

  const handleDragEnd = useCallback(() => {
    if (!isDragging || phase !== "playing") return;
    setIsDragging(false);

    if (cardOffset < -SWIPE_THRESHOLD) {
      handleChoice("left");
    } else if (cardOffset > SWIPE_THRESHOLD) {
      handleChoice("right");
    } else {
      setCardOffset(0);
    }
  }, [isDragging, phase, cardOffset, handleChoice]);

  // Mouse events
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    handleDragStart(e.clientX);
  }, [handleDragStart]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    handleDragMove(e.clientX);
  }, [handleDragMove]);

  const onMouseUp = useCallback(() => {
    handleDragEnd();
  }, [handleDragEnd]);

  const onMouseLeave = useCallback(() => {
    if (isDragging) {
      handleDragEnd();
    }
  }, [isDragging, handleDragEnd]);

  // Touch events
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    handleDragStart(e.touches[0].clientX);
  }, [handleDragStart]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault(); // Prevent page scrolling while swiping
    handleDragMove(e.touches[0].clientX);
  }, [handleDragMove]);

  const onTouchEnd = useCallback(() => {
    handleDragEnd();
  }, [handleDragEnd]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (phase !== "playing") return;

      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
        e.preventDefault();
        handleChoice("left");
      } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
        e.preventDefault();
        handleChoice("right");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [phase, handleChoice]);

  // Calculate card rotation based on offset
  const cardRotation = cardOffset * CARD_ROTATION_FACTOR;
  const cardOpacity = 1 - Math.abs(cardOffset) / CARD_OPACITY_FADE_DISTANCE;

  // Render countdown
  if (phase === "ready") {
    return (
      <div className="flex flex-col items-center justify-center">
        <p className="mb-4 text-center text-lg text-white/60">
          Swipe left to <span className="text-green-400">KEEP</span> valuable salvage<br />
          Swipe right to <span className="text-red-400">DISCARD</span> junk
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
          Item <span className="font-bold text-white">{itemsCompleted + 1}</span> / {totalItems}
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
          style={{ width: `${(itemsCompleted / totalItems) * 100}%` }}
        />
      </div>

      {/* Timer bar */}
      <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full transition-all duration-100 ${
            timeLeft < 1 ? "bg-red-500" : timeLeft < 2 ? "bg-yellow-500" : "bg-green-500"
          }`}
          style={{ width: `${(timeLeft / timePerItem) * 100}%` }}
        />
      </div>

      {/* Direction hints */}
      <div className="mb-4 flex w-full justify-between px-4 text-sm">
        <div className={`flex items-center gap-2 transition-opacity ${cardOffset < -20 ? "opacity-100" : "opacity-40"}`}>
          <span className="text-2xl">✓</span>
          <span className="text-green-400 font-semibold">KEEP</span>
        </div>
        <div className={`flex items-center gap-2 transition-opacity ${cardOffset > 20 ? "opacity-100" : "opacity-40"}`}>
          <span className="text-red-400 font-semibold">DISCARD</span>
          <span className="text-2xl">✗</span>
        </div>
      </div>

      {/* Swipeable card area */}
      <div
        className="relative mb-6 h-64 w-full cursor-grab active:cursor-grabbing"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {currentItem && (
          <div
            className={`absolute left-1/2 top-0 h-full w-56 -translate-x-1/2 select-none rounded-2xl border-2 border-white/20 bg-gradient-to-b from-slate-800/80 to-slate-900/80 p-6 shadow-xl transition-shadow ${
              isDragging ? "shadow-2xl" : ""
            }`}
            style={{
              transform: `translateX(calc(-50% + ${cardOffset}px)) rotate(${cardRotation}deg)`,
              opacity: cardOpacity,
              transition: isDragging ? "none" : "transform 0.3s, opacity 0.3s",
            }}
          >
            {/* Item visual */}
            <div className="flex h-full flex-col items-center justify-center text-center">
              <span className="text-6xl mb-4">{currentItem.emoji}</span>
              <h3 className="text-lg font-bold text-white mb-2">{currentItem.name}</h3>
              <p className="text-sm text-white/70">
                {currentItem.description}
              </p>
            </div>

            {/* Swipe indicator overlays */}
            {cardOffset < -20 && (
              <div
                className="absolute inset-0 flex items-center justify-center rounded-2xl bg-green-500/20 text-4xl font-bold text-green-400"
                style={{ opacity: Math.min(1, Math.abs(cardOffset) / SWIPE_THRESHOLD) }}
              >
                KEEP ✓
              </div>
            )}
            {cardOffset > 20 && (
              <div
                className="absolute inset-0 flex items-center justify-center rounded-2xl bg-red-500/20 text-4xl font-bold text-red-400"
                style={{ opacity: Math.min(1, Math.abs(cardOffset) / SWIPE_THRESHOLD) }}
              >
                DISCARD ✗
              </div>
            )}
          </div>
        )}

        {/* Feedback flash */}
        {feedback && (
          <div className={`absolute inset-0 flex items-center justify-center text-4xl font-bold ${
            feedback.correct ? "text-green-400" : "text-red-400"
          }`}>
            {feedback.correct ? (
              <div className="flex flex-col items-center animate-bounce">
                <span>✓ Correct!</span>
                <span className="text-lg mt-2">+{feedback.points}</span>
              </div>
            ) : (
              <span className="animate-shake">✗ Wrong!</span>
            )}
          </div>
        )}
      </div>

      {/* Phase indicator */}
      <div className="mb-4 h-8 text-center">
        {phase === "playing" && (
          <p className="text-sm text-white/60">
            ← Swipe or use arrow keys →
          </p>
        )}
        {phase === "complete" && (
          <p className="text-xl font-bold text-[#4ade80]">
            Sorting Complete!
          </p>
        )}
      </div>

      {/* Button controls for non-swipe users */}
      <div className="flex gap-4">
        <button
          onClick={() => handleChoice("left")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleChoice("left");
            }
          }}
          disabled={phase !== "playing"}
          className={`flex h-16 w-16 items-center justify-center rounded-full border-2 text-2xl transition-all ${
            phase === "playing"
              ? "border-green-500 bg-green-500/20 hover:bg-green-500/30 active:scale-95"
              : "border-white/20 bg-white/5"
          }`}
          aria-label="Keep item"
        >
          ✓
        </button>
        <button
          onClick={() => handleChoice("right")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleChoice("right");
            }
          }}
          disabled={phase !== "playing"}
          className={`flex h-16 w-16 items-center justify-center rounded-full border-2 text-2xl transition-all ${
            phase === "playing"
              ? "border-red-500 bg-red-500/20 hover:bg-red-500/30 active:scale-95"
              : "border-white/20 bg-white/5"
          }`}
          aria-label="Discard item"
        >
          ✗
        </button>
      </div>

      {/* Difficulty indicators */}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs text-white/40">
        {difficulty.phase === "night" && (
          <div className="flex items-center gap-1">
            <span className="text-purple-400">🌙</span>
            <span>Night mode: Less time</span>
          </div>
        )}
        {difficulty.rust_level > 0.5 && (
          <div className="flex items-center gap-1">
            <span className="text-orange-400">🔥</span>
            <span>High rust: Faster decisions</span>
          </div>
        )}
      </div>
    </div>
  );
}
