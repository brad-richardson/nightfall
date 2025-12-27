import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

// Use vi.hoisted for mocks that will be used in vi.mock
const { mockMapInstance, mockMap, mockAddProtocol, mockRemoveProtocol } = vi.hoisted(() => {
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

  return {
    mockMapInstance,
    mockMap: vi.fn(() => mockMapInstance),
    mockAddProtocol: vi.fn(),
    mockRemoveProtocol: vi.fn()
  };
});

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

// Mock matchMedia
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
});

import DemoMap from "../DemoMap";

describe("DemoMap Lifecycle", () => {
  const mockProps = {
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
    fallbackBbox: {
      xmin: -71.1,
      ymin: 42.3,
      xmax: -71.0,
      ymax: 42.4
    },
    features: [],
    hexes: [],
    crews: [],
    tasks: [],
    cycle: {
      phase: "day" as const,
      phase_progress: 0.5,
      next_phase: "dusk" as const
    },
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
