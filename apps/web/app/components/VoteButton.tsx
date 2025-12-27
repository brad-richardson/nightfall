"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import { ThumbsUp, ThumbsDown, Sparkles } from "lucide-react";

type VoteButtonProps = {
  taskId: string;
  currentVoteScore: number;
  userVote: number | undefined; // 1, -1, or undefined
  onVote: (taskId: string, weight: number) => Promise<void>;
  disabled?: boolean;
  size?: "sm" | "md";
};

type FloatingParticle = {
  id: number;
  x: number;
  y: number;
  text: string;
  color: string;
};

export default function VoteButton({
  taskId,
  currentVoteScore,
  userVote,
  onVote,
  disabled = false,
  size = "md"
}: VoteButtonProps) {
  const [isVoting, setIsVoting] = useState(false);
  const [particles, setParticles] = useState<FloatingParticle[]>([]);
  const [displayScore, setDisplayScore] = useState(currentVoteScore);
  const [scoreChange, setScoreChange] = useState<number | null>(null);
  const [pulseUp, setPulseUp] = useState(false);
  const [pulseDown, setPulseDown] = useState(false);
  const particleId = useRef(0);

  // Sync display score with actual score
  useEffect(() => {
    setDisplayScore(currentVoteScore);
  }, [currentVoteScore]);

  const createParticles = useCallback((isUpvote: boolean) => {
    const newParticles: FloatingParticle[] = [];
    const count = 3 + Math.floor(Math.random() * 3);

    for (let i = 0; i < count; i++) {
      newParticles.push({
        id: particleId.current++,
        x: Math.random() * 40 - 20,
        y: 0,
        text: isUpvote ? "+1" : "-1",
        color: isUpvote ? "var(--night-teal)" : "var(--night-rust)"
      });
    }

    setParticles(prev => [...prev, ...newParticles]);

    // Clean up particles after animation
    setTimeout(() => {
      setParticles(prev => prev.filter(p => !newParticles.includes(p)));
    }, 1000);
  }, []);

  const handleVote = useCallback(async (weight: number) => {
    if (isVoting || disabled) return;

    // If clicking the same vote, toggle it off (vote with opposite weight)
    const actualWeight = userVote === weight ? -weight : weight;
    const isUpvote = actualWeight > 0;

    setIsVoting(true);

    // Trigger pulse animation
    if (isUpvote) {
      setPulseUp(true);
      setTimeout(() => setPulseUp(false), 300);
    } else {
      setPulseDown(true);
      setTimeout(() => setPulseDown(false), 300);
    }

    // Optimistic update with animation
    const previousScore = displayScore;
    const newScore = previousScore + actualWeight;
    setDisplayScore(newScore);
    setScoreChange(actualWeight);

    // Create floating particles
    createParticles(isUpvote);

    try {
      await onVote(taskId, weight);
    } catch {
      // Revert on error
      setDisplayScore(previousScore);
    } finally {
      setIsVoting(false);
      setTimeout(() => setScoreChange(null), 600);
    }
  }, [taskId, userVote, isVoting, disabled, displayScore, onVote, createParticles]);

  const isUpvoted = userVote === 1;
  const isDownvoted = userVote === -1;

  const sizeClasses = size === "sm"
    ? "h-6 w-6 text-[10px]"
    : "h-8 w-8 text-xs";

  const iconSize = size === "sm" ? "h-3 w-3" : "h-4 w-4";

  return (
    <div className="relative flex items-center gap-2">
      {/* Floating particles container */}
      <div className="pointer-events-none absolute inset-0 overflow-visible">
        {particles.map((particle) => (
          <span
            key={particle.id}
            className="absolute left-1/2 top-0 animate-vote-float font-bold"
            style={{
              color: particle.color,
              transform: `translateX(${particle.x}px)`,
              fontSize: size === "sm" ? "10px" : "12px"
            }}
          >
            {particle.text}
          </span>
        ))}
      </div>

      {/* Upvote button */}
      <button
        onClick={() => handleVote(1)}
        disabled={isVoting || disabled}
        className={`
          relative flex items-center justify-center rounded-full transition-all duration-200
          ${sizeClasses}
          ${isUpvoted
            ? "bg-[color:var(--night-teal)] text-white shadow-[0_0_12px_rgba(0,200,180,0.5)]"
            : "bg-white/10 text-white/60 hover:bg-[color:var(--night-teal)]/30 hover:text-[color:var(--night-teal)]"
          }
          ${pulseUp ? "animate-vote-pulse" : ""}
          ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
        `}
        title={isUpvoted ? "Remove upvote" : "Upvote"}
        aria-pressed={isUpvoted}
      >
        <ThumbsUp className={`${iconSize} ${isUpvoted ? "animate-vote-bounce" : ""}`} />
        {isUpvoted && (
          <Sparkles className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 text-yellow-300 animate-pulse" />
        )}
      </button>

      {/* Vote score display */}
      <div className="relative min-w-[40px] text-center">
        <span
          className={`
            text-sm font-bold tabular-nums transition-all duration-300
            ${scoreChange !== null ? "scale-110" : "scale-100"}
            ${isUpvoted ? "text-[color:var(--night-teal)]" : isDownvoted ? "text-[color:var(--night-rust)]" : "text-white/70"}
          `}
        >
          {Math.round(displayScore)}
        </span>

        {/* Score change indicator */}
        {scoreChange !== null && (
          <span
            className={`
              absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] font-bold animate-vote-float
              ${scoreChange > 0 ? "text-[color:var(--night-teal)]" : "text-[color:var(--night-rust)]"}
            `}
          >
            {scoreChange > 0 ? `+${scoreChange}` : scoreChange}
          </span>
        )}
      </div>

      {/* Downvote button */}
      <button
        onClick={() => handleVote(-1)}
        disabled={isVoting || disabled}
        className={`
          relative flex items-center justify-center rounded-full transition-all duration-200
          ${sizeClasses}
          ${isDownvoted
            ? "bg-[color:var(--night-rust)] text-white shadow-[0_0_12px_rgba(200,80,60,0.5)]"
            : "bg-white/10 text-white/60 hover:bg-[color:var(--night-rust)]/30 hover:text-[color:var(--night-rust)]"
          }
          ${pulseDown ? "animate-vote-pulse" : ""}
          ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
        `}
        title={isDownvoted ? "Remove downvote" : "Downvote"}
        aria-pressed={isDownvoted}
      >
        <ThumbsDown className={`${iconSize} ${isDownvoted ? "animate-vote-bounce" : ""}`} />
      </button>
    </div>
  );
}
