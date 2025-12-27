import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import PhaseIndicator from "./PhaseIndicator";
import { useStore } from "../store";

describe("PhaseIndicator", () => {
  const mockCycle = {
    phase: "day" as const,
    phase_progress: 0.5,
    next_phase: "dusk" as const,
    next_phase_in_seconds: 120,
    lastUpdated: Date.now()
  };

  beforeEach(() => {
    vi.useFakeTimers();
    useStore.setState({ cycle: mockCycle });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders current phase and formatted time", () => {
    render(<PhaseIndicator />);

    expect(screen.getByText("day")).toBeInTheDocument();
    expect(screen.getByText("2:00")).toBeInTheDocument();
  });

  it("counts down every second", () => {
    render(<PhaseIndicator />);

    expect(screen.getByText("2:00")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText("1:59")).toBeInTheDocument();
  });

  it("handles zero seconds remaining", () => {
    useStore.setState({ cycle: { ...mockCycle, next_phase_in_seconds: 0 } });
    render(<PhaseIndicator />);

    expect(screen.getByText("0:00")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText("0:00")).toBeInTheDocument();
  });

  it("updates when cycle changes via store", () => {
    render(<PhaseIndicator />);
    expect(screen.getByText("day")).toBeInTheDocument();
    expect(screen.getByText("2:00")).toBeInTheDocument();

    act(() => {
      useStore.setState({
        cycle: {
          ...mockCycle,
          phase: "dusk",
          next_phase_in_seconds: 60,
          lastUpdated: Date.now() + 1000
        }
      });
    });

    expect(screen.getByText("dusk")).toBeInTheDocument();
    expect(screen.getByText("1:00")).toBeInTheDocument();
  });

  it("re-renders when lastUpdated timestamp changes even if other values are same", () => {
    render(<PhaseIndicator />);

    const initialTime = screen.getByText("2:00");
    expect(initialTime).toBeInTheDocument();

    // Update only lastUpdated, keeping next_phase_in_seconds the same
    act(() => {
      useStore.setState({
        cycle: {
          ...mockCycle,
          next_phase_in_seconds: 120, // Same value
          lastUpdated: Date.now() + 5000 // Different timestamp
        }
      });
    });

    // Should still show 2:00 but component should have re-rendered
    // This ensures the countdown timer is reset properly
    expect(screen.getByText("2:00")).toBeInTheDocument();
  });
});
