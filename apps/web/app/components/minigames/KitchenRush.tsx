"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { MinigameDifficulty } from "../../store";

type KitchenRushProps = {
  config: {
    base_rounds: number;
    max_score: number;
    expected_duration_ms: number;
  };
  difficulty: MinigameDifficulty;
  onComplete: (score: number) => void;
};

type GamePhase = "ready" | "showing" | "input" | "success" | "fail" | "complete";

const STATIONS = [
  { id: 0, icon: "🍳", name: "Grill", color: "#ef4444" },
  { id: 1, icon: "🥗", name: "Salad", color: "#22c55e" },
  { id: 2, icon: "🍜", name: "Soup", color: "#f59e0b" },
  { id: 3, icon: "🍰", name: "Dessert", color: "#ec4899" },
];

// Base timing values (will be modified by difficulty)
const BASE_SHOW_DURATION = 600; // ms per station shown
const BASE_PAUSE_BETWEEN = 300; // ms between stations
const FEEDBACK_DELAY = 400; // ms to show success/fail before next round

export default function KitchenRush({ config, difficulty, onComplete }: KitchenRushProps) {
  const [phase, setPhase] = useState<GamePhase>("ready");
  const [sequence, setSequence] = useState<number[]>([]);
  const [playerInput, setPlayerInput] = useState<number[]>([]);
  const [activeStation, setActiveStation] = useState<number | null>(null);
  const [round, setRound] = useState(0);
  const [score, setScore] = useState(0);
  const [countdown, setCountdown] = useState(3);

  const showTimeoutRef = useRef<NodeJS.Timeout>();
  const inputTimeoutRef = useRef<NodeJS.Timeout>();

  // Adjust timing based on difficulty
  const showDuration = Math.round(BASE_SHOW_DURATION / difficulty.speed_mult);
  const pauseBetween = Math.round(BASE_PAUSE_BETWEEN / difficulty.speed_mult);

  // Calculate max rounds based on config
  const maxRounds = config.base_rounds;

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (showTimeoutRef.current) clearTimeout(showTimeoutRef.current);
      if (inputTimeoutRef.current) clearTimeout(inputTimeoutRef.current);
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
      startNewRound([]);
    }
  }, [countdown, phase]);

  const startNewRound = useCallback((currentSequence: number[]) => {
    // Add a new random station to the sequence
    const newStation = Math.floor(Math.random() * STATIONS.length);
    const newSequence = [...currentSequence, newStation];
    setSequence(newSequence);
    setPlayerInput([]);
    setRound((r) => r + 1);
    setPhase("showing");

    // Show the sequence
    let showIndex = 0;
    const showNext = () => {
      if (showIndex < newSequence.length) {
        setActiveStation(newSequence[showIndex]);
        showTimeoutRef.current = setTimeout(() => {
          setActiveStation(null);
          showIndex++;
          showTimeoutRef.current = setTimeout(showNext, pauseBetween);
        }, showDuration);
      } else {
        // Done showing, allow input
        setPhase("input");
      }
    };

    // Small delay before starting to show
    showTimeoutRef.current = setTimeout(showNext, 500);
  }, [showDuration, pauseBetween]);

  const handleStationClick = useCallback((stationId: number) => {
    if (phase !== "input") return;

    const newInput = [...playerInput, stationId];
    setPlayerInput(newInput);
    setActiveStation(stationId);

    // Brief flash effect
    setTimeout(() => setActiveStation(null), 150);

    const expectedStation = sequence[newInput.length - 1];

    if (stationId !== expectedStation) {
      // Wrong input - game over
      setPhase("fail");
      setTimeout(() => {
        // Calculate final score based on rounds completed
        const roundScore = Math.round((round - 1) / maxRounds * config.max_score);
        onComplete(Math.max(0, roundScore));
      }, FEEDBACK_DELAY);
      return;
    }

    if (newInput.length === sequence.length) {
      // Completed the round
      const roundPoints = Math.round(config.max_score / maxRounds);
      setScore((s) => s + roundPoints);

      if (round >= maxRounds) {
        // Game complete - perfect score!
        setPhase("complete");
        setTimeout(() => {
          onComplete(config.max_score);
        }, FEEDBACK_DELAY);
      } else {
        // Show success and move to next round
        setPhase("success");
        setTimeout(() => {
          startNewRound(sequence);
        }, FEEDBACK_DELAY);
      }
    }
  }, [phase, playerInput, sequence, round, maxRounds, config.max_score, onComplete, startNewRound]);

  // Render ready state with countdown
  if (phase === "ready") {
    return (
      <div className="flex flex-col items-center justify-center">
        <p className="mb-4 text-lg text-white/60">Remember the order!</p>
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[color:var(--night-teal)]/20 text-5xl font-bold text-[color:var(--night-teal)]">
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
          Round <span className="font-bold text-white">{round}</span> / {maxRounds}
        </div>
        <div className="text-white/60">
          Score: <span className="font-bold text-[color:var(--night-teal)]">{score}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-8 h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full bg-gradient-to-r from-[color:var(--night-teal)] to-[#4ade80] transition-all duration-300"
          style={{ width: `${(round / maxRounds) * 100}%` }}
        />
      </div>

      {/* Game phase indicator */}
      <div className="mb-6 h-8 text-center">
        {phase === "showing" && (
          <p className="animate-pulse text-lg font-medium text-[#facc15]">
            Watch the sequence...
          </p>
        )}
        {phase === "input" && (
          <p className="text-lg font-medium text-[color:var(--night-teal)]">
            Repeat the order! ({playerInput.length}/{sequence.length})
          </p>
        )}
        {phase === "success" && (
          <p className="text-lg font-medium text-[#4ade80]">
            Correct!
          </p>
        )}
        {phase === "fail" && (
          <p className="text-lg font-medium text-[#ef4444]">
            Wrong order!
          </p>
        )}
        {phase === "complete" && (
          <p className="text-lg font-medium text-[#4ade80]">
            Perfect! All rounds complete!
          </p>
        )}
      </div>

      {/* Station buttons */}
      <div className="grid grid-cols-2 gap-4">
        {STATIONS.map((station) => {
          const isActive = activeStation === station.id;
          const isClickable = phase === "input";

          return (
            <button
              key={station.id}
              onClick={() => handleStationClick(station.id)}
              disabled={!isClickable}
              className={`relative flex h-28 w-28 flex-col items-center justify-center rounded-2xl border-2 transition-all duration-150 ${
                isActive
                  ? "scale-105 border-white shadow-[0_0_30px_rgba(255,255,255,0.3)]"
                  : "border-white/10 hover:border-white/30"
              } ${
                isClickable
                  ? "cursor-pointer active:scale-95"
                  : "cursor-default opacity-70"
              }`}
              style={{
                backgroundColor: isActive ? station.color : `${station.color}20`,
              }}
            >
              <span className="text-4xl">{station.icon}</span>
              <span
                className={`mt-1 text-xs font-medium uppercase tracking-wider ${
                  isActive ? "text-white" : "text-white/60"
                }`}
              >
                {station.name}
              </span>
            </button>
          );
        })}
      </div>

      {/* Input progress indicator */}
      {phase === "input" && sequence.length > 0 && (
        <div className="mt-6 flex gap-2">
          {sequence.map((_, idx) => (
            <div
              key={idx}
              className={`h-3 w-3 rounded-full transition-all ${
                idx < playerInput.length
                  ? "bg-[color:var(--night-teal)]"
                  : "bg-white/20"
              }`}
            />
          ))}
        </div>
      )}

      {/* Difficulty indicators */}
      {difficulty.phase === "night" && (
        <div className="mt-6 flex items-center gap-2 text-xs text-white/40">
          <span className="text-purple-400">🌙</span>
          <span>Night mode: Faster sequence</span>
        </div>
      )}
    </div>
  );
}
