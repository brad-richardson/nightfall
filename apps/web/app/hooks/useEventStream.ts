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
  onEventRef.current = onEvent;

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let retryCount = 0;
    const maxRetries = 10;

    function connect() {
      const url = `${baseUrl}/api/stream`;
      eventSource = new EventSource(url);

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
        console.error("SSE error", err);
        eventSource?.close();
        
        if (retryCount < maxRetries) {
          retryCount++;
          const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
          setTimeout(connect, delay);
        }
      };

      eventSource.onopen = () => {
        retryCount = 0;
      };
    }

    connect();

    return () => {
      eventSource?.close();
    };
  }, [baseUrl]);
}
