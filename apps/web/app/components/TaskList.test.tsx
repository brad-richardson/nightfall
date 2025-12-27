import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TaskList from "./TaskList";

const tasks = [
  {
    task_id: "task-1",
    target_gers_id: "road-alpha-1234",
    priority_score: 90,
    status: "queued",
    vote_score: 10,
    cost_food: 5,
    cost_equipment: 2,
    cost_energy: 2,
    cost_materials: 5,
    duration_s: 30,
    repair_amount: 2,
    task_type: "repair_bridge"
  },
  {
    task_id: "task-2",
    target_gers_id: "road-bravo-5678",
    priority_score: 40,
    status: "in_progress",
    vote_score: 50,
    cost_food: 20,
    cost_equipment: 10,
    cost_energy: 10,
    cost_materials: 30,
    duration_s: 10,
    repair_amount: 5,
    task_type: "patch_pothole"
  },
  {
    task_id: "task-3",
    target_gers_id: "road-charlie-9999",
    priority_score: 75,
    status: "queued",
    vote_score: 5,
    cost_food: 1,
    cost_equipment: 1,
    cost_energy: 1,
    cost_materials: 1,
    duration_s: 60,
    repair_amount: 8,
    task_type: "repair_sign"
  }
];

describe("TaskList", () => {
  it("filters tasks by search query", () => {
    vi.useFakeTimers();

    render(<TaskList tasks={tasks} crews={[]} features={[]} onVote={vi.fn()} />);
    const input = screen.getByPlaceholderText(/search tasks/i);

    fireEvent.change(input, { target: { value: "pothole" } });

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(screen.getByText(/patch pothole/i)).toBeInTheDocument();
    expect(screen.queryByText(/repair bridge/i)).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it("filters queued tasks from filter chips", () => {
    render(<TaskList tasks={tasks} crews={[]} features={[]} onVote={vi.fn()} />);

    const queuedChip = screen.getByRole("button", { name: /queued/i });
    fireEvent.click(queuedChip);

    expect(screen.getByText(/repair bridge/i)).toBeInTheDocument();
    expect(screen.getByText(/repair sign/i)).toBeInTheDocument();
    expect(screen.queryByText(/patch pothole/i)).not.toBeInTheDocument();
  });

  it("sorts tasks by total cost", () => {
    render(<TaskList tasks={tasks} crews={[]} features={[]} onVote={vi.fn()} />);

    const sortSelect = screen.getByRole("combobox");
    fireEvent.change(sortSelect, { target: { value: "cost" } });

    const roadLabels = screen.getAllByText(/Road/i);
    expect(roadLabels[0].textContent).toContain("road-bra");
  });
});
