"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Clock, AlertTriangle, Search, X, Users, CheckCircle2, Timer, Navigation, ChevronDown } from "lucide-react";
import { formatLabel } from "../lib/formatters";
import type { Task, Crew, Feature, UserVotes } from "../store";
import VoteButton from "./VoteButton";

type ResourcePools = {
  food: number;
  equipment: number;
  energy: number;
  materials: number;
};

type TaskListProps = {
  tasks: Task[];
  crews: Crew[];
  features: Feature[];
  userVotes: UserVotes;
  resourcePools: ResourcePools;
  onVote: (taskId: string, weight: number) => Promise<void>;
};

type TaskFilter = "all" | "queued" | "in_progress" | "high_priority";
type TaskSort = "priority" | "votes" | "cost" | "duration";

// Resource colors matching ResourcePoolsPanel
const RESOURCE_COLORS = {
  food: { label: "rgba(74, 222, 128, 0.6)", value: "rgba(74, 222, 128, 0.9)", insufficient: "rgba(239, 68, 68, 0.9)" },
  equipment: { label: "rgba(249, 115, 22, 0.6)", value: "rgba(249, 115, 22, 0.9)", insufficient: "rgba(239, 68, 68, 0.9)" },
  energy: { label: "rgba(250, 204, 21, 0.6)", value: "rgba(250, 204, 21, 0.9)", insufficient: "rgba(239, 68, 68, 0.9)" },
  materials: { label: "rgba(129, 140, 248, 0.6)", value: "rgba(129, 140, 248, 0.9)", insufficient: "rgba(239, 68, 68, 0.9)" }
};

export default function TaskList({ tasks, crews, features, userVotes, resourcePools, onVote }: TaskListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<TaskFilter>("all");
  const [sortBy, setSortBy] = useState<TaskSort>("priority");
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, 200);

    return () => window.clearTimeout(handle);
  }, [searchQuery]);

  const filterOptions: TaskFilter[] = ["all", "queued", "in_progress", "high_priority"];

  const taskCounts = useMemo<Record<TaskFilter, number>>(() => {
    const queued = tasks.filter((t) => t.status === "queued" || t.status === "pending").length;
    const inProgress = tasks.filter((t) => t.status === "active").length;
    const highPriority = tasks.filter((t) => t.priority_score >= 70).length;
    return {
      all: tasks.length,
      queued,
      in_progress: inProgress,
      high_priority: highPriority
    };
  }, [tasks]);

  const featureMap = useMemo(() => {
    const map = new Map<string, Feature>();
    for (const f of features) {
      map.set(f.gers_id, f);
    }
    return map;
  }, [features]);

  const crewMap = useMemo(() => {
    const map = new Map<string, Crew>();
    for (const c of crews) {
      if (c.active_task_id) {
        map.set(c.active_task_id, c);
      }
    }
    return map;
  }, [crews]);

  const filteredTasks = useMemo(() => {
    let result = [...tasks];

    if (debouncedQuery) {
      const query = debouncedQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.target_gers_id.toLowerCase().includes(query) ||
          t.task_type.toLowerCase().includes(query)
      );
    }

    switch (activeFilter) {
      case "queued":
        result = result.filter((t) => t.status === "queued" || t.status === "pending");
        break;
      case "in_progress":
        result = result.filter((t) => t.status === "active");
        break;
      case "high_priority":
        result = result.filter((t) => t.priority_score >= 70);
        break;
    }

    result.sort((a, b) => {
      switch (sortBy) {
        case "priority":
          return b.priority_score - a.priority_score;
        case "votes":
          return b.vote_score - a.vote_score;
        case "cost":
          return (b.cost_food + b.cost_equipment + b.cost_energy + b.cost_materials) - (a.cost_food + a.cost_equipment + a.cost_energy + a.cost_materials);
        case "duration":
          return b.duration_s - a.duration_s;
        default:
          return 0;
      }
    });

    return result;
  }, [tasks, debouncedQuery, activeFilter, sortBy]);

  const showSummary = debouncedQuery.length > 0 || activeFilter !== "all";

  const getTaskTitle = (task: Task) => {
    const feature = featureMap.get(task.target_gers_id);
    if (feature?.road_class) {
      const cls = feature.road_class.replace(/_/g, " ");
      return cls.charAt(0).toUpperCase() + cls.slice(1) + " Repair";
    }
    return "Road Repair";
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "text-[color:var(--night-teal)] bg-[color:var(--night-teal)]/10 border-[color:var(--night-teal)]/20";
      case "queued":
        return "text-amber-400 bg-amber-400/10 border-amber-400/20";
      default:
        return "text-white/40 bg-white/5 border-white/10";
    }
  };

  const getInsufficientResources = (task: Task) => {
    const insufficient: string[] = [];
    if (task.cost_food > resourcePools.food) insufficient.push("food");
    if (task.cost_equipment > resourcePools.equipment) insufficient.push("equipment");
    if (task.cost_energy > resourcePools.energy) insufficient.push("energy");
    if (task.cost_materials > resourcePools.materials) insufficient.push("materials");
    return insufficient;
  };

  return (
    <div className="flex h-full flex-col space-y-3">
      <div className="flex shrink-0 items-center justify-between border-b border-white/5 pb-2">
        <h3 className="text-xs font-bold uppercase tracking-[0.3em] text-[color:var(--night-ash)]">
          Active Tasks
        </h3>
        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-white/40">
          {tasks.length}
        </span>
      </div>

      {/* Collapsible filters section */}
      <div className="shrink-0">
        <button
          type="button"
          onClick={() => setFiltersExpanded(!filtersExpanded)}
          className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[10px] uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10"
        >
          <span className="flex items-center gap-2">
            <Search className="h-3 w-3" />
            Filters & Sort
            {showSummary && (
              <span className="rounded bg-[color:var(--night-teal)]/20 px-1.5 py-0.5 text-[9px] text-[color:var(--night-teal)]">
                Active
              </span>
            )}
          </span>
          <ChevronDown className={`h-3 w-3 transition-transform ${filtersExpanded ? "rotate-180" : ""}`} />
        </button>

        {filtersExpanded && (
          <div className="mt-2 space-y-3 rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <input
                type="text"
                placeholder="Search tasks..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setSearchQuery("");
                    (event.target as HTMLInputElement).blur();
                  }
                }}
                className="w-full rounded-lg border border-white/10 bg-black/20 py-2 pl-9 pr-10 text-xs text-white/80 placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[color:var(--night-teal)]"
                aria-label="Search tasks"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-white/40 hover:text-white"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {filterOptions.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setActiveFilter(filter)}
                  className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] uppercase tracking-wider transition-colors ${
                    activeFilter === filter
                      ? "border-[color:var(--night-teal)] bg-[color:var(--night-teal)]/20 text-[color:var(--night-teal)]"
                      : "border-white/10 bg-black/20 text-white/50 hover:border-white/20 hover:text-white/70"
                  }`}
                  aria-pressed={activeFilter === filter}
                >
                  {formatLabel(filter)}
                  <span className="rounded-full bg-white/10 px-1 text-[8px] font-semibold text-white/70">
                    {taskCounts[filter]}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[9px] uppercase tracking-wider text-white/40">Sort:</span>
              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as TaskSort)}
                className="flex-1 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-[10px] text-white/80 focus:outline-none focus:ring-2 focus:ring-[color:var(--night-teal)]"
              >
                <option value="priority">Priority</option>
                <option value="votes">Community Votes</option>
                <option value="cost">Total Cost</option>
                <option value="duration">Duration</option>
              </select>
            </div>
          </div>
        )}

        {showSummary && !filtersExpanded && (
          <div className="mt-1.5 text-[9px] uppercase tracking-wider text-white/40">
            Showing {filteredTasks.length} of {tasks.length}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-2 custom-scrollbar">
        {filteredTasks.length > 0 ? (
          filteredTasks.map((task) => {
            const assignedCrew = crewMap.get(task.task_id);
            const isAssigned = !!assignedCrew;
            const statusColor = getStatusColor(task.status);
            const insufficientResources = getInsufficientResources(task);

            return (
              <div
                key={task.task_id}
                className={`group relative rounded-2xl border bg-white/5 p-4 transition-all hover:bg-white/[0.08] ${
                  isAssigned
                    ? "border-[color:var(--night-teal)]/30"
                    : "border-white/5 hover:border-white/10"
                }`}
              >
                {isAssigned && (
                  <div className="absolute -right-px -top-px overflow-hidden rounded-bl-xl rounded-tr-2xl bg-[color:var(--night-teal)]/20 px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-[color:var(--night-teal)] backdrop-blur-sm">
                    <span className="flex items-center gap-1.5">
                      <Users className="h-3 w-3" />
                      Crew Active
                    </span>
                  </div>
                )}

                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--night-teal)]">
                        {getTaskTitle(task)}
                      </p>
                      <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${statusColor}`}>
                        {formatLabel(task.status)}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          window.dispatchEvent(new CustomEvent("nightfall:fly_to_feature", {
                            detail: { gers_id: task.target_gers_id }
                          }));
                        }}
                        className="rounded-full p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-[color:var(--night-teal)]"
                        title="Fly to location"
                        aria-label="Fly to location on map"
                      >
                        <Navigation className="h-3 w-3" />
                      </button>
                    </div>
                    <p className="text-xs font-medium text-white/60 line-clamp-1 font-mono">
                      ID: {task.target_gers_id.slice(0, 8)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-tighter text-white/40">Priority</p>
                    <p className="text-sm font-bold tabular-nums text-[color:var(--night-glow)]">
                      {Math.round(task.priority_score)}
                    </p>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  <div className="grid grid-cols-4 gap-1.5">
                    <div className={`flex flex-col items-center rounded-lg py-1.5 ${insufficientResources.includes("food") ? "bg-red-500/10" : "bg-black/20"}`}>
                      <p className="text-[8px] uppercase" style={{ color: RESOURCE_COLORS.food.label }}>Food</p>
                      <p className="text-[10px] font-bold" style={{ color: insufficientResources.includes("food") ? RESOURCE_COLORS.food.insufficient : RESOURCE_COLORS.food.value }}>{task.cost_food}</p>
                    </div>
                    <div className={`flex flex-col items-center rounded-lg py-1.5 ${insufficientResources.includes("equipment") ? "bg-red-500/10" : "bg-black/20"}`}>
                      <p className="text-[8px] uppercase" style={{ color: RESOURCE_COLORS.equipment.label }}>Equip</p>
                      <p className="text-[10px] font-bold" style={{ color: insufficientResources.includes("equipment") ? RESOURCE_COLORS.equipment.insufficient : RESOURCE_COLORS.equipment.value }}>{task.cost_equipment}</p>
                    </div>
                    <div className={`flex flex-col items-center rounded-lg py-1.5 ${insufficientResources.includes("energy") ? "bg-red-500/10" : "bg-black/20"}`}>
                      <p className="text-[8px] uppercase" style={{ color: RESOURCE_COLORS.energy.label }}>Energy</p>
                      <p className="text-[10px] font-bold" style={{ color: insufficientResources.includes("energy") ? RESOURCE_COLORS.energy.insufficient : RESOURCE_COLORS.energy.value }}>{task.cost_energy}</p>
                    </div>
                    <div className={`flex flex-col items-center rounded-lg py-1.5 ${insufficientResources.includes("materials") ? "bg-red-500/10" : "bg-black/20"}`}>
                      <p className="text-[8px] uppercase" style={{ color: RESOURCE_COLORS.materials.label }}>Mats</p>
                      <p className="text-[10px] font-bold" style={{ color: insufficientResources.includes("materials") ? RESOURCE_COLORS.materials.insufficient : RESOURCE_COLORS.materials.value }}>{task.cost_materials}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="flex items-center justify-center gap-2 rounded-lg bg-black/20 py-1.5">
                      <Clock className="h-3 w-3 text-white/30" />
                      <p className="text-[9px] uppercase text-white/40">Time</p>
                      <p className="text-[10px] font-bold text-white/70">{task.duration_s}s</p>
                    </div>
                    <div className="flex items-center justify-center gap-2 rounded-lg bg-black/20 py-1.5">
                      <AlertTriangle className="h-3 w-3 text-white/30" />
                      <p className="text-[9px] uppercase text-white/40">Heals to</p>
                      <p className="text-[10px] font-bold text-[color:var(--night-teal)]">100%</p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3">
                  {task.status !== "active" ? (
                    <VoteButton
                      taskId={task.task_id}
                      currentVoteScore={task.vote_score}
                      userVote={userVotes[task.task_id]}
                      onVote={onVote}
                      size="sm"
                    />
                  ) : (
                    <>
                      <span className="text-[10px] font-bold tabular-nums text-white/60">
                        {Math.round(task.vote_score)} votes
                      </span>
                      <div className="flex items-center gap-1.5 text-[color:var(--night-teal)]">
                        <Timer className="h-3.5 w-3.5 animate-pulse" />
                        <span className="text-[10px] font-bold uppercase tracking-wider">Working</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex h-full flex-col items-center justify-center py-8 text-center">
            <div className="mb-3 rounded-full bg-white/5 p-3">
              <CheckCircle2 className="h-6 w-6 text-white/20" />
            </div>
            <p className="text-xs font-medium text-white/50">
              {tasks.length === 0 ? "No active tasks" : "No matches found"}
            </p>
            <p className="mt-1 text-[10px] text-white/30">
              {tasks.length === 0 ? "The queue is currently empty." : "Try adjusting your filters."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
