"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { MinigameDifficulty } from "../../../store";

type TrafficDirectorProps = {
  config: {
    base_rounds: number;
    max_score: number;
    expected_duration_ms: number;
  };
  difficulty: MinigameDifficulty;
  onComplete: (score: number) => void;
};

type GamePhase = "ready" | "playing" | "complete";

type Vehicle = {
  id: string;
  lane: number;
  direction: "left" | "right";
  type: "car" | "truck" | "bus";
  position: number; // 0-100, where 50 is the intersection
  speed: number;
  stopped: boolean;
};

type LightState = "go" | "stop";

// Scoring
const SCORE_PERFECT = 100; // Vehicle passes smoothly
const SCORE_GOOD = 75;     // Vehicle stopped briefly
const SCORE_MISS = -50;    // Collision

// Vehicle configs
const VEHICLE_CONFIG = {
  car: { width: 30, length: 50, speed: 1.2, color: "#60a5fa" },
  truck: { width: 35, length: 70, speed: 0.8, color: "#f97316" },
  bus: { width: 35, length: 80, speed: 0.7, color: "#fbbf24" },
};

const VEHICLE_TYPES: Array<"car" | "truck" | "bus"> = ["car", "car", "car", "truck", "bus"];

// Lane positions
const LANE_POSITIONS = {
  0: { y: 60, direction: "right" as const },   // Top horizontal lane going right
  1: { y: 220, direction: "left" as const },   // Bottom horizontal lane going left
};

const INTERSECTION_START = 120;
const INTERSECTION_END = 200;
const LANE_COUNT = 2;

export default function TrafficDirector({ config, difficulty, onComplete }: TrafficDirectorProps) {
  const [phase, setPhase] = useState<GamePhase>("ready");
  const [countdown, setCountdown] = useState(3);
  const [score, setScore] = useState(0);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [lightState, setLightState] = useState<LightState>("go");
  const [vehiclesPassed, setVehiclesPassed] = useState(0);
  const [collisions, setCollisions] = useState(0);
  const [lastAction, setLastAction] = useState<{ text: string; color: string } | null>(null);

  const animationRef = useRef<number>();
  const lastTimeRef = useRef<number>(0);
  const lastSpawnRef = useRef<number>(0);
  const scoreRef = useRef(score);
  const vehiclesSpawnedRef = useRef(0);

  scoreRef.current = score;

  const gameWidth = 320;
  const gameHeight = 280;
  const totalVehicles = config.base_rounds;
  const baseSpeed = 80 * difficulty.speed_mult; // pixels per second
  const spawnInterval = 1500 / difficulty.speed_mult;

  // Generate random vehicle
  const generateVehicle = useCallback((): Vehicle => {
    const lane = Math.floor(Math.random() * LANE_COUNT);
    const laneConfig = LANE_POSITIONS[lane as keyof typeof LANE_POSITIONS];
    const type = VEHICLE_TYPES[Math.floor(Math.random() * VEHICLE_TYPES.length)];
    const vehicleConfig = VEHICLE_CONFIG[type];

    return {
      id: `vehicle-${Date.now()}-${Math.random()}`,
      lane,
      direction: laneConfig.direction,
      type,
      position: laneConfig.direction === "right" ? -20 : 120,
      speed: vehicleConfig.speed,
      stopped: false,
    };
  }, []);

  // Toggle light state
  const toggleLight = useCallback(() => {
    if (phase !== "playing") return;
    setLightState((prev) => (prev === "go" ? "stop" : "go"));
  }, [phase]);

  // Handle keyboard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        toggleLight();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleLight]);

  // Countdown
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

    const animate = (time: number) => {
      if (lastTimeRef.current === 0) {
        lastTimeRef.current = time;
      }

      const delta = (time - lastTimeRef.current) / 1000;
      lastTimeRef.current = time;
      const now = Date.now();

      // Spawn new vehicles
      if (
        vehiclesSpawnedRef.current < totalVehicles &&
        now - lastSpawnRef.current > spawnInterval
      ) {
        lastSpawnRef.current = now;
        vehiclesSpawnedRef.current += 1;
        setVehicles((prev) => [...prev, generateVehicle()]);
      }

      // Update vehicle positions
      setVehicles((prev) => {
        const updated: Vehicle[] = [];
        let newPassed = 0;
        let newScore = 0;
        let action: { text: string; color: string } | null = null;

        for (const vehicle of prev) {
          const speed = baseSpeed * vehicle.speed;

          // Check if vehicle is approaching intersection and should stop
          const approachingIntersection =
            (vehicle.direction === "right" &&
              vehicle.position > INTERSECTION_START - 60 &&
              vehicle.position < INTERSECTION_START) ||
            (vehicle.direction === "left" &&
              vehicle.position < INTERSECTION_END + 60 &&
              vehicle.position > INTERSECTION_END);

          const shouldStop = lightState === "stop" && approachingIntersection;

          let newPosition = vehicle.position;
          let stopped = vehicle.stopped;

          if (shouldStop && !vehicle.stopped) {
            stopped = true;
          } else if (!shouldStop && vehicle.stopped) {
            stopped = false;
          }

          if (!stopped) {
            newPosition =
              vehicle.direction === "right"
                ? vehicle.position + speed * delta
                : vehicle.position - speed * delta;
          }

          // Check if vehicle exited
          const exited =
            (vehicle.direction === "right" && newPosition > 120) ||
            (vehicle.direction === "left" && newPosition < -20);

          if (exited) {
            newPassed += 1;
            // Score based on whether vehicle had to stop
            if (!vehicle.stopped) {
              newScore += SCORE_PERFECT;
              action = { text: "SMOOTH!", color: "#4ade80" };
            } else {
              newScore += SCORE_GOOD;
              action = { text: "GOOD", color: "#60a5fa" };
            }
          } else {
            updated.push({
              ...vehicle,
              position: newPosition,
              stopped,
            });
          }
        }

        // Check for collisions in intersection
        const inIntersection = updated.filter(
          (v) =>
            (v.direction === "right" &&
              v.position > INTERSECTION_START - 20 &&
              v.position < INTERSECTION_END + 20) ||
            (v.direction === "left" &&
              v.position < INTERSECTION_END + 20 &&
              v.position > INTERSECTION_START - 20)
        );

        // Check if vehicles from different lanes overlap
        const lane0Vehicles = inIntersection.filter((v) => v.lane === 0);
        const lane1Vehicles = inIntersection.filter((v) => v.lane === 1);

        if (lane0Vehicles.length > 0 && lane1Vehicles.length > 0) {
          for (const v0 of lane0Vehicles) {
            for (const v1 of lane1Vehicles) {
              // Simple overlap check
              const v0Config = VEHICLE_CONFIG[v0.type];
              const v1Config = VEHICLE_CONFIG[v1.type];
              const v0Right = v0.position * 2.5 + v0Config.length / 2;
              const v0Left = v0.position * 2.5 - v0Config.length / 2;
              const v1Right = (100 - v1.position) * 2.5 + v1Config.length / 2;
              const v1Left = (100 - v1.position) * 2.5 - v1Config.length / 2;

              const overlap = !(v0Right < v1Left || v0Left > v1Right);
              if (overlap && !v0.stopped && !v1.stopped) {
                newScore += SCORE_MISS;
                action = { text: "COLLISION!", color: "#ef4444" };
                setCollisions((c) => c + 1);
              }
            }
          }
        }

        if (newPassed > 0) {
          setVehiclesPassed((p) => p + newPassed);
          setScore((s) => Math.max(0, s + newScore));
          if (action) setLastAction(action);
          setTimeout(() => setLastAction(null), 500);
        }

        return updated;
      });

      // Check game end
      if (
        vehiclesSpawnedRef.current >= totalVehicles &&
        vehicles.length === 0
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
  }, [phase, vehicles, lightState, totalVehicles, baseSpeed, spawnInterval, generateVehicle, onComplete]);

  // Cleanup
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
        <p className="mb-4 text-lg text-white/60">Control traffic through the work zone!</p>
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-amber-500/20 text-5xl font-bold text-amber-400">
          {countdown}
        </div>
        <p className="mt-4 text-sm text-white/40">Tap to toggle the signal</p>
      </div>
    );
  }

  const progress = vehiclesPassed / totalVehicles;

  return (
    <div className="flex w-full max-w-md flex-col items-center">
      {/* Status bar */}
      <div className="mb-4 flex w-full items-center justify-between text-sm">
        <div className="text-white/60">
          Passed: <span className="font-bold text-green-400">{vehiclesPassed}</span> / {totalVehicles}
        </div>
        <div className="text-white/60">
          Score: <span className="font-bold text-amber-400">{score}</span>
        </div>
      </div>

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
        className="relative mb-4 overflow-hidden rounded-2xl border-2 border-white/10 bg-gradient-to-b from-green-900/50 to-green-950/50"
        style={{ width: gameWidth, height: gameHeight }}
        onClick={toggleLight}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            toggleLight();
          }
        }}
        aria-label={`Traffic signal: ${lightState}. Tap to toggle.`}
      >
        {/* Grass background */}
        <div className="absolute inset-0 bg-gradient-to-b from-green-800/30 to-green-900/30" />

        {/* Roads */}
        {/* Horizontal road (top lane - going right) */}
        <div
          className="absolute bg-gradient-to-b from-gray-600 to-gray-700"
          style={{
            top: LANE_POSITIONS[0].y - 25,
            left: 0,
            right: 0,
            height: 50,
          }}
        >
          <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 border-t-2 border-dashed border-yellow-400/40" />
        </div>

        {/* Horizontal road (bottom lane - going left) */}
        <div
          className="absolute bg-gradient-to-b from-gray-600 to-gray-700"
          style={{
            top: LANE_POSITIONS[1].y - 25,
            left: 0,
            right: 0,
            height: 50,
          }}
        >
          <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 border-t-2 border-dashed border-yellow-400/40" />
        </div>

        {/* Work zone indicator */}
        <div
          className="absolute border-2 border-dashed border-orange-500/50 bg-orange-500/10"
          style={{
            left: INTERSECTION_START,
            right: gameWidth - INTERSECTION_END,
            top: 0,
            bottom: 0,
          }}
        >
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="rounded bg-orange-500/80 px-2 py-1 text-xs font-bold text-white">
              WORK ZONE
            </div>
          </div>
        </div>

        {/* Traffic signals */}
        <div className="absolute left-1/2 top-4 -translate-x-1/2">
          <div
            className={`flex h-16 w-8 flex-col items-center justify-around rounded-lg border-2 transition-all ${
              lightState === "go"
                ? "border-green-400 bg-gray-800 shadow-[0_0_20px_rgba(74,222,128,0.5)]"
                : "border-red-400 bg-gray-800 shadow-[0_0_20px_rgba(239,68,68,0.5)]"
            }`}
          >
            <div
              className={`h-5 w-5 rounded-full transition-all ${
                lightState === "stop"
                  ? "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]"
                  : "bg-red-900/50"
              }`}
            />
            <div
              className={`h-5 w-5 rounded-full transition-all ${
                lightState === "go"
                  ? "bg-green-500 shadow-[0_0_10px_rgba(74,222,128,0.8)]"
                  : "bg-green-900/50"
              }`}
            />
          </div>
        </div>

        {/* Vehicles */}
        {vehicles.map((vehicle) => {
          const config = VEHICLE_CONFIG[vehicle.type];
          const laneConfig = LANE_POSITIONS[vehicle.lane as keyof typeof LANE_POSITIONS];
          const x =
            vehicle.direction === "right"
              ? vehicle.position * 2.5
              : gameWidth - vehicle.position * 2.5;

          return (
            <div
              key={vehicle.id}
              className="absolute transition-transform duration-75"
              style={{
                left: x - config.length / 2,
                top: laneConfig.y - config.width / 2,
                width: config.length,
                height: config.width,
                transform: vehicle.direction === "left" ? "scaleX(-1)" : undefined,
              }}
            >
              {/* Vehicle body */}
              <div
                className="h-full w-full rounded-lg"
                style={{
                  background: `linear-gradient(to right, ${config.color}cc, ${config.color})`,
                  boxShadow: `0 2px 8px ${config.color}40`,
                }}
              >
                {/* Windows */}
                <div
                  className="absolute right-2 top-1 bottom-1 w-1/3 rounded-sm bg-black/30"
                />
                {/* Headlights */}
                <div className="absolute right-0 top-1 h-2 w-1 rounded-r bg-yellow-200" />
                <div className="absolute right-0 bottom-1 h-2 w-1 rounded-r bg-yellow-200" />
              </div>
              {/* Stop indicator */}
              {vehicle.stopped && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 rounded bg-red-500 px-1 text-[10px] font-bold text-white">
                  STOP
                </div>
              )}
            </div>
          );
        })}

        {/* Action popup */}
        {lastAction && (
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-2xl font-bold"
            style={{ color: lastAction.color }}
          >
            {lastAction.text}
          </div>
        )}
      </div>

      {/* Signal control button */}
      <button
        type="button"
        onClick={toggleLight}
        className={`mb-4 rounded-xl px-8 py-3 text-sm font-bold uppercase tracking-wider transition-all ${
          lightState === "go"
            ? "bg-green-500 text-white shadow-[0_4px_20px_rgba(74,222,128,0.4)] hover:bg-green-400"
            : "bg-red-500 text-white shadow-[0_4px_20px_rgba(239,68,68,0.4)] hover:bg-red-400"
        }`}
      >
        {lightState === "go" ? "🟢 Signal: GO" : "🔴 Signal: STOP"}
      </button>

      {/* Instructions */}
      <p className="text-center text-xs text-white/40">
        Tap or press <kbd className="rounded bg-white/10 px-1.5 py-0.5">Space</kbd> to toggle the signal
      </p>

      {/* Stats */}
      {collisions > 0 && (
        <div className="mt-2 text-xs text-red-400">
          Collisions: {collisions}
        </div>
      )}

      {/* Difficulty indicators */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-white/40">
        {difficulty.phase === "night" && (
          <div className="flex items-center gap-1">
            <span className="text-purple-400">🌙</span>
            <span>Night mode: Faster traffic</span>
          </div>
        )}
      </div>
    </div>
  );
}
