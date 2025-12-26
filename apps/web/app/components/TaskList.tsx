"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Hammer, Vote, Clock, AlertTriangle, Search, X } from "lucide-react";
import { formatNumber, formatLabel } from "../lib/formatters";

type Task = {
  task_id: string;
  target_gers_id: string;
  priority_score: number;
  status: string;
  vote_score: number;
  cost_labor: number;
  cost_materials: number;
  duration_s: number;
  repair_amount: number;
  task_type: string;
};

type TaskListProps = {
  tasks: Task[];
  onVote: (taskId: string, weight: number) => void;
};

type TaskFilter = "all" | "queued" | "in_progress" | "high_priority";
type TaskSort = "priority" | "votes" | "cost" | "duration";

export default function TaskList({ tasks, onVote }: TaskListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<TaskFilter>("all");
  const [sortBy, setSortBy] = useState<TaskSort>("priority");

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, 200);

    return () => window.clearTimeout(handle);
  }, [searchQuery]);

  const filterOptions: TaskFilter[] = ["all", "queued", "in_progress", "high_priority"];

  const taskCounts = useMemo<Record<TaskFilter, number>>(() => {
    const queued = tasks.filter((t) => t.status === "queued" || t.status === "pending").length;
    const inProgress = tasks.filter((t) => t.status === "in_progress").length;
    const highPriority = tasks.filter((t) => t.priority_score >= 70).length;
    return {
      all: tasks.length,
      queued,
      in_progress: inProgress,
      high_priority: highPriority
    };
  }, [tasks]);

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
        result = result.filter((t) => t.status === "in_progress");
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
          return (b.cost_labor + b.cost_materials) - (a.cost_labor + a.cost_materials);
        case "duration":
          return b.duration_s - a.duration_s;
        default:
          return 0;
      }
    });

    return result;
  }, [tasks, debouncedQuery, activeFilter, sortBy]);

  const showSummary = debouncedQuery.length > 0 || activeFilter !== "all";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-white/5 pb-2">
        <h3 className="text-xs font-bold uppercase tracking-[0.3em] text-[color:var(--night-ash)]">
          Active Tasks
        </h3>
        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-white/40">
          {tasks.length}
        </span>
      </div>

      <div className="space-y-3">
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
            className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-10 text-xs text-white/80 placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[color:var(--night-teal)]"
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

        <div className="flex flex-wrap gap-2">
          {filterOptions.map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setActiveFilter(filter)}
              className={`flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] uppercase tracking-widest transition-colors ${
                activeFilter === filter
                  ? "border-[color:var(--night-teal)] bg-[color:var(--night-teal)]/20 text-[color:var(--night-teal)]"
                  : "border-white/10 bg-white/5 text-white/50 hover:border-white/20 hover:text-white/70"
              }`}
              aria-pressed={activeFilter === filter}
            >
              {formatLabel(filter)}
              <span className="min-w-[18px] rounded-full bg-white/10 px-1 text-[9px] font-semibold text-white/70">
                {taskCounts[filter]}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] uppercase tracking-[0.3em] text-white/40">
            Sort
          </span>
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as TaskSort)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-white/80 focus:outline-none focus:ring-2 focus:ring-[color:var(--night-teal)]"
          >
            <option value="priority">Priority</option>
            <option value="votes">Community Votes</option>
            <option value="cost">Total Cost</option>
            <option value="duration">Duration</option>
          </select>
        </div>

        {showSummary ? (
          <div className="text-[10px] uppercase tracking-[0.2em] text-white/40">
            Showing {filteredTasks.length} of {tasks.length}
          </div>
        ) : null}
      </div>

      <div className="max-h-[400px] space-y-3 overflow-y-auto pr-2 custom-scrollbar">
        {filteredTasks.length > 0 ? (
          filteredTasks.map((task) => (
            <div
              key={task.task_id}
              className="group rounded-2xl border border-white/5 bg-white/5 p-4 transition-all hover:border-white/10 hover:bg-white/[0.08]"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--night-teal)]">
                    {task.task_type.replace("_", " ")}
                  </p>
                  <p className="text-xs font-medium text-white/80 line-clamp-1">
                    Road {task.target_gers_id.slice(0, 8)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-tighter text-white/40">Priority</p>
                  <p className="text-sm font-bold tabular-nums text-[color:var(--night-glow)]">
                    {Math.round(task.priority_score)}
                  </p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="flex flex-col items-center rounded-lg bg-black/20 py-2">
                  <Hammer className="mb-1 h-3 w-3 text-white/30" />
                  <p className="text-[9px] uppercase text-white/40">Labor</p>
                  <p className="text-[10px] font-bold text-white/70">{task.cost_labor}</p>
                </div>
                <div className="flex flex-col items-center rounded-lg bg-black/20 py-2">
                  <Clock className="mb-1 h-3 w-3 text-white/30" />
                  <p className="text-[9px] uppercase text-white/40">Time</p>
                  <p className="text-[10px] font-bold text-white/70">{task.duration_s}s</p>
                </div>
                <div className="flex flex-col items-center rounded-lg bg-black/20 py-2">
                  <AlertTriangle className="mb-1 h-3 w-3 text-white/30" />
                  <p className="text-[9px] uppercase text-white/40">Repair</p>
                  <p className="text-[10px] font-bold text-white/70">+{task.repair_amount}</p>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold tabular-nums text-white/60">
                    {formatNumber(task.vote_score)} votes
                  </span>
                </div>
                <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={() => onVote(task.task_id, 1)}
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-[color:var(--night-teal)]/20 text-[color:var(--night-teal)] transition-colors hover:bg-[color:var(--night-teal)] hover:text-white"
                    title="Vote Up"
                  >
                    <Vote className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="py-8 text-center">
            <p className="text-xs text-white/30 italic">
              {tasks.length === 0 ? "No pending tasks in this region." : "No tasks match the current filters."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
