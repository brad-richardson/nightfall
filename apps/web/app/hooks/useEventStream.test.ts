import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEventStream } from "./useEventStream";

describe("useEventStream", () => {
  let mockEventSource: {
    addEventListener: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    onerror: null;
    onopen: null;
  };
  const eventListeners: Record<string, ((e: { data: string }) => void)[]> = {};

  beforeEach(() => {
    mockEventSource = {
      addEventListener: vi.fn((event, handler) => {
        if (!eventListeners[event]) eventListeners[event] = [];
        eventListeners[event].push(handler);
      }),
      close: vi.fn(),
      onerror: null,
      onopen: null,
    };

    vi.stubGlobal("EventSource", vi.fn(() => mockEventSource));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.keys(eventListeners).forEach(key => delete eventListeners[key]);
  });

  it("connects to the correct URL", () => {
    const baseUrl = "http://api.test";
    renderHook(() => useEventStream(baseUrl, vi.fn()));

    expect(global.EventSource).toHaveBeenCalledWith(`${baseUrl}/api/stream`);
  });

  it("subscribes to all expected events", () => {
    renderHook(() => useEventStream("http://api.test", vi.fn()));

    const expectedEvents = [
      "phase_change",
      "world_delta",
      "feature_delta",
      "task_delta",
      "feed_item",
      "reset_warning",
      "reset"
    ];

    expectedEvents.forEach(event => {
      expect(mockEventSource.addEventListener).toHaveBeenCalledWith(event, expect.any(Function));
    });
  });

  it("calls onEvent when an event is received", () => {
    const onEvent = vi.fn();
    renderHook(() => useEventStream("http://api.test", onEvent));

    const phaseChangeHandler = eventListeners["phase_change"][0];
    const mockData = { phase: "night" };
    
    phaseChangeHandler({ data: JSON.stringify(mockData) });

    expect(onEvent).toHaveBeenCalledWith({
      event: "phase_change",
      data: mockData
    });
  });

  it("closes the connection on unmount", () => {
    const { unmount } = renderHook(() => useEventStream("http://api.test", vi.fn()));
    unmount();
    expect(mockEventSource.close).toHaveBeenCalled();
  });
});
