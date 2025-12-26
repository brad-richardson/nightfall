"use client";

import React from "react";
import { Hammer, Vote, Clock, AlertTriangle } from "lucide-react";

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

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export default function TaskList({ tasks, onVote }: TaskListProps) {
  const sortedTasks = [...tasks].sort((a, b) => b.priority_score - a.priority_score);

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

      <div className="max-h-[400px] space-y-3 overflow-y-auto pr-2 custom-scrollbar">
        {sortedTasks.length > 0 ? (
          sortedTasks.map((task) => (
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
            <p className="text-xs text-white/30 italic">No pending tasks in this region.</p>
          </div>
        )}
      </div>
    </div>
  );
}
