import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TaskList from "./TaskList";

const mockResourcePools = {
  food: 100,
  equipment: 100,
  energy: 100,
  materials: 100
};

const mockUserVotes = {};

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
    status: "active",
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

    render(<TaskList tasks={tasks} crews={[]} features={[]} userVotes={mockUserVotes} resourcePools={mockResourcePools} onVote={vi.fn()} />);

    // Open the collapsible filters section first
    const filtersButton = screen.getByRole("button", { name: /filters & sort/i });
    fireEvent.click(filtersButton);

    const input = screen.getByPlaceholderText(/search tasks/i);

    // Search by target_gers_id which contains "bravo"
    fireEvent.change(input, { target: { value: "bravo" } });

    act(() => {
      vi.advanceTimersByTime(250);
    });

    // After filtering, only task-2 (road-bravo-5678) should be shown
    // Check for the ID prefix and that other tasks are not shown
    expect(screen.getByText(/road-bra/)).toBeInTheDocument();
    expect(screen.queryByText(/road-alp/)).not.toBeInTheDocument();
    expect(screen.queryByText(/road-cha/)).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it("filters queued tasks from filter chips", () => {
    render(<TaskList tasks={tasks} crews={[]} features={[]} userVotes={mockUserVotes} resourcePools={mockResourcePools} onVote={vi.fn()} />);

    // Open the collapsible filters section first
    const filtersButton = screen.getByRole("button", { name: /filters & sort/i });
    fireEvent.click(filtersButton);

    const queuedChip = screen.getByRole("button", { name: /queued/i });
    fireEvent.click(queuedChip);

    // task-1 and task-3 are queued, task-2 is active
    expect(screen.getByText(/road-alp/)).toBeInTheDocument();
    expect(screen.getByText(/road-cha/)).toBeInTheDocument();
    expect(screen.queryByText(/road-bra/)).not.toBeInTheDocument();
  });

  it("sorts tasks by total cost", () => {
    render(<TaskList tasks={tasks} crews={[]} features={[]} userVotes={mockUserVotes} resourcePools={mockResourcePools} onVote={vi.fn()} />);

    // Open the collapsible filters section first
    const filtersButton = screen.getByRole("button", { name: /filters & sort/i });
    fireEvent.click(filtersButton);

    const sortSelect = screen.getByRole("combobox");
    fireEvent.change(sortSelect, { target: { value: "cost" } });

    // Task-2 has highest cost (20+10+10+30=70), so it should be first
    // Check that the IDs are in the expected order
    const idLabels = screen.getAllByText(/ID:/);
    expect(idLabels[0].textContent).toContain("road-bra");
  });
});
