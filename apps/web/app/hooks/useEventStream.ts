"use client";

import { useEffect, useRef } from "react";

export type EventPayload = {
  event: string;
  data: unknown;
};

// Server sends heartbeats every 15 seconds
// We consider the connection stale if we miss 2 heartbeats (30 seconds)
// Exported so Dashboard can use the same value for polling fallback
export const SSE_STALE_THRESHOLD_MS = 30000;

// Threshold for visibility change - matches heartbeat interval
// Too aggressive causes unnecessary reconnections on tab switching
const VISIBILITY_STALE_THRESHOLD_MS = 15000;

export function useEventStream(
  baseUrl: string,
  onEvent: (payload: EventPayload) => void
) {
  const onEventRef = useRef(onEvent);
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryTimeoutRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const lastEventTimeRef = useRef<number>(Date.now());
  const lastEventIdRef = useRef<string | null>(null);
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

    function reconnect(reason: string) {
      if (!active) return;
      console.debug("[SSE] Reconnecting:", reason);
      clearRetryTimeout();
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      // Reset retry count for visibility-triggered reconnects
      retryCountRef.current = 0;
      connect();
    }

    function connect() {
      if (!active) return;
      const url = baseUrl ? `${baseUrl}/api/stream` : "/api/stream";
      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      // Game event handlers
      const gameHandlers = [
        "phase_change",
        "world_delta",
        "feature_delta",
        "task_delta",
        "resource_transfer",
        "crew_delta",
        "reset_warning",
        "reset"
      ];

      gameHandlers.forEach((eventName) => {
        eventSource?.addEventListener(eventName, (e: MessageEvent) => {
          // Track last event time to detect stale connections
          lastEventTimeRef.current = Date.now();
          // Track last event ID for replay on reconnection (native EventSource sends this header automatically)
          if (e.lastEventId) {
            lastEventIdRef.current = e.lastEventId;
          }
          let data = {};
          try {
            data = JSON.parse(e.data);
            // Debug logging for rust_bulk
            if ((data as Record<string, unknown>)?.type === "rust_bulk") {
              console.debug("[useEventStream] Received rust_bulk event:", data);
            }
          } catch (err) {
            console.error("Failed to parse event data", err);
          }
          onEventRef.current({ event: eventName, data });
        });
      });

      // Heartbeat handler - server sends every 15s to detect dead connections
      eventSource?.addEventListener("heartbeat", () => {
        lastEventTimeRef.current = Date.now();
        // Don't forward heartbeats to the event handler - they're just for connection health
      });

      eventSource.onerror = () => {
        if (!active || eventSourceRef.current !== eventSource) return;
        // EventSource errors don't provide useful info - check readyState instead
        // 0 = CONNECTING, 1 = OPEN, 2 = CLOSED
        const state = eventSource.readyState;
        const stateNames = ['CONNECTING', 'OPEN', 'CLOSED'];
        console.warn(`[SSE] Connection error (state: ${stateNames[state] || state}), will retry...`);
        eventSource.close();
        eventSourceRef.current = null;

        if (retryCountRef.current < maxRetries) {
          retryCountRef.current += 1;
          // Exponential backoff with jitter to prevent thundering herd
          const baseDelay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000);
          const jitter = Math.random() * 0.3 * baseDelay; // 0-30% jitter
          const delay = baseDelay + jitter;
          console.debug(`[SSE] Retry ${retryCountRef.current}/${maxRetries} in ${Math.round(delay)}ms`);
          clearRetryTimeout();
          retryTimeoutRef.current = window.setTimeout(connect, delay);
        } else {
          console.error(`[SSE] Max retries (${maxRetries}) reached, giving up`);
        }
      };

      eventSource.onopen = () => {
        if (!active || eventSourceRef.current !== eventSource) return;
        retryCountRef.current = 0;
        lastEventTimeRef.current = Date.now();
        onEventRef.current({ event: "connected", data: {} });
      };
    }

    // Handle page visibility changes - critical for both mobile AND desktop
    // When switching tabs on desktop, browsers throttle/freeze JavaScript
    // When the page becomes visible, the SSE connection may have silently dropped
    const handleVisibilityChange = () => {
      if (!active) return;

      if (document.visibilityState === "visible") {
        const timeSinceLastEvent = Date.now() - lastEventTimeRef.current;
        const isConnectionMissing = !eventSourceRef.current;
        // Use shorter threshold for visibility change - be more aggressive
        const isConnectionStale = timeSinceLastEvent > VISIBILITY_STALE_THRESHOLD_MS;

        if (isConnectionMissing || isConnectionStale) {
          reconnect(isConnectionMissing ? "connection missing after visibility change" : "connection stale after visibility change");
          // Emit reconnected event so Dashboard can refresh state if needed
          // Include lastEventId so client knows if replay happened
          onEventRef.current({ event: "reconnected", data: { reason: "visibility_change", lastEventId: lastEventIdRef.current } });
        }
      }
    };

    // Handle online/offline events - networks can be unreliable
    const handleOnline = () => {
      if (!active) return;
      console.debug("[SSE] Network came online");
      const isConnectionMissing = !eventSourceRef.current;
      if (isConnectionMissing) {
        reconnect("network came online");
        onEventRef.current({ event: "reconnected", data: { reason: "network_online", lastEventId: lastEventIdRef.current } });
      }
    };

    connect();

    // Add visibility change listener for background/foreground on mobile AND desktop
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);

    return () => {
      active = false;
      clearRetryTimeout();
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
    };
  }, [baseUrl]);
}
