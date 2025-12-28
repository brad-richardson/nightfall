"use client";

import { useMemo } from "react";
import { useStore } from "../store";
import {
  getPlayerTier,
  getTierProgress,
  PLAYER_TIERS
} from "@nightfall/config";

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}

type BadgeSize = "sm" | "md" | "lg";

type PlayerTierBadgeProps = {
  size?: BadgeSize;
  showProgress?: boolean;
  showDetails?: boolean;
  className?: string;
};

const sizeClasses: Record<BadgeSize, { badge: string; icon: string; text: string; progress: string }> = {
  sm: {
    badge: "px-2 py-1 gap-1.5",
    icon: "text-sm",
    text: "text-[10px]",
    progress: "h-1"
  },
  md: {
    badge: "px-3 py-2 gap-2",
    icon: "text-lg",
    text: "text-xs",
    progress: "h-1.5"
  },
  lg: {
    badge: "px-4 py-3 gap-3",
    icon: "text-2xl",
    text: "text-sm",
    progress: "h-2"
  }
};

export function PlayerTierBadge({
  size = "md",
  showProgress = true,
  showDetails = false,
  className = ""
}: PlayerTierBadgeProps) {
  const playerScore = useStore((state) => state.playerScore);

  const tierInfo = useMemo(() => {
    const tier = getPlayerTier(playerScore.totalScore);
    const config = PLAYER_TIERS[tier];
    const progress = getTierProgress(playerScore.totalScore);
    return { config, progress };
  }, [playerScore.totalScore]);

  const { config, progress } = tierInfo;
  const classes = sizeClasses[size];

  return (
    <div className={`flex flex-col ${className}`}>
      <div
        className={`flex items-center rounded-xl border border-white/10 bg-black/40 backdrop-blur-sm ${classes.badge}`}
        style={{
          boxShadow: `0 0 12px ${config.color}40`
        }}
      >
        <span className={classes.icon}>{config.badgeIcon}</span>
        <div className="flex flex-col">
          <span
            className={`font-semibold uppercase tracking-wider ${classes.text}`}
            style={{ color: config.color }}
          >
            {config.label}
          </span>
          <span className={`text-white/50 ${classes.text}`}>
            {formatNumber(playerScore.totalScore)} pts
          </span>
        </div>
      </div>

      {showProgress && progress.nextTier && (
        <div className="mt-2 px-1">
          <div className={`w-full overflow-hidden rounded-full bg-white/10 ${classes.progress}`}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${progress.progress * 100}%`,
                backgroundColor: PLAYER_TIERS[progress.nextTier].color
              }}
            />
          </div>
          <div className={`mt-1 flex justify-between text-white/40 ${classes.text}`}>
            <span>{formatNumber(progress.scoreToNext)} to {PLAYER_TIERS[progress.nextTier].label}</span>
          </div>
        </div>
      )}

      {showDetails && (
        <div className={`mt-3 grid grid-cols-2 gap-2 ${classes.text}`}>
          <TierBenefit label="Resource Bonus" value={`+${Math.round((config.resourceBonus - 1) * 100)}%`} active={config.resourceBonus > 1} />
          <TierBenefit label="Transfer Speed" value={`+${Math.round((config.transferSpeedBonus - 1) * 100)}%`} active={config.transferSpeedBonus > 1} />
          <TierBenefit label="Emergency Repairs" value={`${config.emergencyRepairCharges}/day`} active={config.emergencyRepairCharges > 0} />
        </div>
      )}
    </div>
  );
}

function TierBenefit({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <div className={`rounded-lg px-2 py-1.5 ${active ? "bg-white/10" : "bg-white/5 opacity-50"}`}>
      <div className="text-[9px] uppercase tracking-wider text-white/40">{label}</div>
      <div className={`font-medium ${active ? "text-white" : "text-white/30"}`}>{value}</div>
    </div>
  );
}

// Compact version for header display
export function PlayerTierBadgeCompact({ className = "" }: { className?: string }) {
  const playerScore = useStore((state) => state.playerScore);
  const tier = getPlayerTier(playerScore.totalScore);
  const config = PLAYER_TIERS[tier];
  const progress = getTierProgress(playerScore.totalScore);

  return (
    <button
      type="button"
      className={`group relative flex items-center gap-1.5 rounded-full border border-white/10 bg-black/40 px-2 py-1 text-white/80 backdrop-blur-sm transition-all hover:border-white/20 hover:bg-black/60 ${className}`}
      style={{ boxShadow: `0 0 8px ${config.color}30` }}
      title={`${config.label}: ${playerScore.totalScore.toLocaleString()} points`}
    >
      <span className="text-sm">{config.badgeIcon}</span>
      <span
        className="text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: config.color }}
      >
        {config.label}
      </span>
      {progress.nextTier && (
        <div className="h-3 w-[40px] overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${progress.progress * 100}%`,
              backgroundColor: PLAYER_TIERS[progress.nextTier].color
            }}
          />
        </div>
      )}

      {/* Tooltip on hover */}
      <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-lg border border-white/10 bg-black/90 p-3 text-left opacity-0 shadow-lg backdrop-blur-md transition-opacity group-hover:opacity-100">
        <div className="whitespace-nowrap text-xs font-semibold" style={{ color: config.color }}>
          {config.badgeIcon} {config.label}
        </div>
        <div className="mt-1 text-[10px] text-white/60">
          {formatNumber(playerScore.totalScore)} total points
        </div>
        {progress.nextTier && (
          <div className="mt-1 text-[10px] text-white/40">
            {formatNumber(progress.scoreToNext)} to {PLAYER_TIERS[progress.nextTier].label}
          </div>
        )}
        <div className="mt-2 space-y-0.5 text-[9px]">
          {config.resourceBonus > 1 && (
            <div className="text-green-400">+{Math.round((config.resourceBonus - 1) * 100)}% resource bonus</div>
          )}
          {config.transferSpeedBonus > 1 && (
            <div className="text-blue-400">+{Math.round((config.transferSpeedBonus - 1) * 100)}% faster transfers</div>
          )}
          {config.emergencyRepairCharges > 0 && (
            <div className="text-amber-400">{config.emergencyRepairCharges} emergency repairs/day</div>
          )}
        </div>
      </div>
    </button>
  );
}
