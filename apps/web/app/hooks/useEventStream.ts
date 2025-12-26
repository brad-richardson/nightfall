"use client";

import { useEffect, useRef } from "react";

export type EventPayload = {
  event: string;
  data: unknown;
};

export function useEventStream(
  baseUrl: string,
  onEvent: (payload: EventPayload) => void
) {
  const onEventRef = useRef(onEvent);
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryTimeoutRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  onEventRef.current = onEvent;

  useEffect(() => {
    let active = true;
    const maxRetries = 10;
    const clearRetryTimeout = () => {
      if (retryTimeoutRef.current !== null) {
        window.clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };

    function connect() {
      if (!active) return;
      const url = baseUrl ? `${baseUrl}/api/stream` : "/api/stream";
      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      const handlers = [
        "phase_change",
        "world_delta",
        "feature_delta",
        "task_delta",
        "feed_item",
        "resource_transfer",
        "reset_warning",
        "reset"
      ];

      handlers.forEach((eventName) => {
        eventSource?.addEventListener(eventName, (e: MessageEvent) => {
          let data = {};
          try {
            data = JSON.parse(e.data);
          } catch (err) {
            console.error("Failed to parse event data", err);
          }
          onEventRef.current({ event: eventName, data });
        });
      });

      eventSource.onerror = (err) => {
        if (!active || eventSourceRef.current !== eventSource) return;
        console.error("SSE error", err);
        eventSource.close();
        eventSourceRef.current = null;

        if (retryCountRef.current < maxRetries) {
          retryCountRef.current += 1;
          const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000);
          clearRetryTimeout();
          retryTimeoutRef.current = window.setTimeout(connect, delay);
        }
      };

      eventSource.onopen = () => {
        if (!active || eventSourceRef.current !== eventSource) return;
        retryCountRef.current = 0;
        onEventRef.current({ event: "connected", data: {} });
      };
    }

    connect();

    return () => {
      active = false;
      clearRetryTimeout();
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, [baseUrl]);
}
