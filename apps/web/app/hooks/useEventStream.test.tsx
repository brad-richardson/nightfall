import React from "react";
import { act, render } from "@testing-library/react";
import { useEventStream } from "./useEventStream";

// Type declaration for test mock injection
declare global {
  var EventSource: typeof MockEventSource;
}

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onerror: ((event: Event) => void) | null = null;
  onopen: (() => void) | null = null;
  closed = false;
  private listeners: Record<string, Array<(event: MessageEvent) => void>> = {};

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(event: string, handler: (event: MessageEvent) => void) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(handler);
  }

  close() {
    this.closed = true;
  }

  emit(event: string, data: unknown) {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    const message = { data: payload } as MessageEvent;
    this.listeners[event]?.forEach((handler) => handler(message));
  }
}

describe("useEventStream", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    globalThis.EventSource = MockEventSource;
  });

  it("connects to the stream and emits connected on open", () => {
    const events: Array<{ event: string; data: unknown }> = [];

    function TestComponent() {
      useEventStream("", (payload) => events.push(payload));
      return null;
    }

    const { unmount } = render(<TestComponent />);

    const instance = MockEventSource.instances[0];
    expect(instance).toBeDefined();
    expect(instance.url).toBe("/api/stream");

    act(() => {
      instance.onopen?.();
    });

    expect(events[0]).toEqual({ event: "connected", data: {} });

    act(() => {
      instance.emit("phase_change", { phase: "night" });
    });

    expect(events[1]).toEqual({ event: "phase_change", data: { phase: "night" } });

    unmount();
    expect(instance.closed).toBe(true);
  });
});
