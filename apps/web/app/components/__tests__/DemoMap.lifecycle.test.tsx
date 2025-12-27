import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import DemoMap from "../DemoMap";

// Mock maplibre-gl
const mockMapInstance = {
  on: vi.fn(),
  off: vi.fn(),
  remove: vi.fn(),
  resize: vi.fn(),
  getSource: vi.fn(() => ({ setData: vi.fn() })),
  setFilter: vi.fn(),
  setPaintProperty: vi.fn(),
  queryRenderedFeatures: vi.fn(() => []),
  getCanvas: vi.fn(() => ({ style: {} }))
};

const mockMap = vi.fn(() => mockMapInstance);
const mockAddProtocol = vi.fn();
const mockRemoveProtocol = vi.fn();

vi.mock("maplibre-gl", () => ({
  default: {
    Map: mockMap,
    addProtocol: mockAddProtocol,
    removeProtocol: mockRemoveProtocol
  }
}));

// Mock pmtiles
vi.mock("pmtiles", () => ({
  Protocol: vi.fn(() => ({
    tile: vi.fn()
  }))
}));

// Mock ResizeObserver
global.ResizeObserver = vi.fn(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn()
}));

describe("DemoMap Lifecycle", () => {
  const mockProps = {
    region: {
      region_id: "test-region",
      name: "Test Region",
      boundary: {
        type: "Polygon" as const,
        coordinates: [
          [
            [-71.1, 42.3],
            [-71.0, 42.3],
            [-71.0, 42.4],
            [-71.1, 42.4],
            [-71.1, 42.3]
          ]
        ]
      },
      pool_food: 100,
      pool_equipment: 100,
      pool_energy: 100,
      pool_materials: 100,
      crews: [],
      tasks: [],
      stats: {
        total_roads: 10,
        healthy_roads: 5,
        degraded_roads: 5,
        rust_avg: 0.5,
        health_avg: 0.5
      }
    },
    features: [],
    hexes: [],
    phase: "day" as const,
    pmtilesRelease: "2024-01-01"
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockMapInstance.on.mockImplementation((event, callback) => {
      if (event === "load") {
        setTimeout(callback, 0);
      }
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("initializes map without errors", () => {
    const { container } = render(<DemoMap {...mockProps} />);

    expect(container.querySelector(".map-shell")).toBeTruthy();
    expect(mockMap).toHaveBeenCalledTimes(1);
    expect(mockAddProtocol).toHaveBeenCalledWith("pmtiles", expect.any(Function));
  });

  it("handles Strict Mode double mount/unmount", () => {
    // First mount
    const { unmount: unmount1 } = render(<DemoMap {...mockProps} />);
    expect(mockMap).toHaveBeenCalledTimes(1);

    // Unmount
    unmount1();
    expect(mockMapInstance.remove).toHaveBeenCalledTimes(1);
    expect(mockRemoveProtocol).toHaveBeenCalledWith("pmtiles");

    vi.clearAllMocks();

    // Second mount (simulating Strict Mode remount)
    const { unmount: unmount2 } = render(<DemoMap {...mockProps} />);
    expect(mockMap).toHaveBeenCalledTimes(1);

    // Cleanup
    unmount2();
    expect(mockMapInstance.remove).toHaveBeenCalledTimes(1);
  });

  it("cleans up properly on unmount", () => {
    const { unmount } = render(<DemoMap {...mockProps} />);

    unmount();

    // Verify map.remove() was called
    expect(mockMapInstance.remove).toHaveBeenCalledTimes(1);

    // Verify protocol was removed
    expect(mockRemoveProtocol).toHaveBeenCalledWith("pmtiles");
  });

  it("prevents duplicate map initialization", () => {
    // Render once
    const { rerender } = render(<DemoMap {...mockProps} />);

    // Rerender with same props
    rerender(<DemoMap {...mockProps} />);

    // Map should only be created once despite rerender
    expect(mockMap).toHaveBeenCalledTimes(1);
  });

  it("handles null boundary gracefully", () => {
    const propsWithNullBoundary = {
      ...mockProps,
      region: {
        ...mockProps.region,
        boundary: null
      }
    };

    expect(() => render(<DemoMap {...propsWithNullBoundary} />)).not.toThrow();
  });

  it("attaches resize observer to map container", () => {
    render(<DemoMap {...mockProps} />);

    expect(ResizeObserver).toHaveBeenCalled();
  });

  it("handles boundary changes without recreating map", () => {
    const { rerender } = render(<DemoMap {...mockProps} />);

    const newProps = {
      ...mockProps,
      region: {
        ...mockProps.region,
        boundary: {
          type: "Polygon" as const,
          coordinates: [
            [
              [-72.1, 43.3],
              [-72.0, 43.3],
              [-72.0, 43.4],
              [-72.1, 43.4],
              [-72.1, 43.3]
            ]
          ]
        }
      }
    };

    rerender(<DemoMap {...newProps} />);

    // Map should only be created once
    expect(mockMap).toHaveBeenCalledTimes(1);
    // But map should not be removed/recreated
    expect(mockMapInstance.remove).not.toHaveBeenCalled();
  });
});
