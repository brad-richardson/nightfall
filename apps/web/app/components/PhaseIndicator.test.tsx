import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import PhaseIndicator from "./PhaseIndicator";

describe("PhaseIndicator", () => {
  const mockCycle = {
    phase: "day" as const,
    phase_progress: 0.5,
    next_phase: "dusk" as const,
    next_phase_in_seconds: 120
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders current phase and formatted time", () => {
    render(<PhaseIndicator cycle={mockCycle} />);
    
    expect(screen.getByText("day")).toBeInTheDocument();
    expect(screen.getByText("2:00")).toBeInTheDocument();
  });

  it("counts down every second", () => {
    render(<PhaseIndicator cycle={mockCycle} />);
    
    expect(screen.getByText("2:00")).toBeInTheDocument();
    
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    
    expect(screen.getByText("1:59")).toBeInTheDocument();
  });

  it("handles zero seconds remaining", () => {
    render(<PhaseIndicator cycle={{ ...mockCycle, next_phase_in_seconds: 0 }} />);
    
    expect(screen.getByText("0:00")).toBeInTheDocument();
    
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    
    expect(screen.getByText("0:00")).toBeInTheDocument();
  });

  it("updates when cycle prop changes", () => {
    const { rerender } = render(<PhaseIndicator cycle={mockCycle} />);
    expect(screen.getByText("day")).toBeInTheDocument();
    expect(screen.getByText("2:00")).toBeInTheDocument();

    rerender(<PhaseIndicator cycle={{ ...mockCycle, phase: "dusk", next_phase_in_seconds: 60 }} />);
    expect(screen.getByText("dusk")).toBeInTheDocument();
    expect(screen.getByText("1:00")).toBeInTheDocument();
  });
});
