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
  const lastEventTimeRef = useRef<number>(Date.now());
  const connectionCheckIntervalRef = useRef<number | null>(null);
  onEventRef.current = onEvent;

  useEffect(() => {
    let active = true;
    const maxRetries = 10;
    // Maximum time without events before we consider the connection stale (45 seconds)
    // The ticker sends world_delta every ~10 seconds, so 45s means we missed several
    const CONNECTION_STALE_THRESHOLD_MS = 45000;

    const clearRetryTimeout = () => {
      if (retryTimeoutRef.current !== null) {
        window.clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };

    const clearConnectionCheck = () => {
      if (connectionCheckIntervalRef.current !== null) {
        window.clearInterval(connectionCheckIntervalRef.current);
        connectionCheckIntervalRef.current = null;
      }
    };

    function reconnect(reason: string) {
      if (!active) return;
      console.debug("[SSE] Reconnecting:", reason);
      clearRetryTimeout();
      clearConnectionCheck();
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

      const handlers = [
        "phase_change",
        "world_delta",
        "feature_delta",
        "task_delta",
        "resource_transfer",
        "reset_warning",
        "reset"
      ];

      handlers.forEach((eventName) => {
        eventSource?.addEventListener(eventName, (e: MessageEvent) => {
          // Track last event time to detect stale connections
          lastEventTimeRef.current = Date.now();
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
        clearConnectionCheck();

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
        lastEventTimeRef.current = Date.now();
        onEventRef.current({ event: "connected", data: {} });

        // Start periodic check for stale connections
        // This catches cases where the connection appears open but isn't receiving data
        clearConnectionCheck();
        connectionCheckIntervalRef.current = window.setInterval(() => {
          const timeSinceLastEvent = Date.now() - lastEventTimeRef.current;
          if (timeSinceLastEvent > CONNECTION_STALE_THRESHOLD_MS) {
            reconnect("connection stale - no events received");
          }
        }, 15000); // Check every 15 seconds
      };
    }

    // Handle page visibility changes - critical for mobile
    // When the page becomes visible after being hidden, the SSE connection
    // may have been silently dropped by the mobile browser
    const handleVisibilityChange = () => {
      if (!active) return;

      if (document.visibilityState === "visible") {
        const timeSinceLastEvent = Date.now() - lastEventTimeRef.current;
        const isConnectionMissing = !eventSourceRef.current;
        const isConnectionStale = timeSinceLastEvent > CONNECTION_STALE_THRESHOLD_MS;

        if (isConnectionMissing || isConnectionStale) {
          reconnect(isConnectionMissing ? "connection missing after visibility change" : "connection stale after visibility change");
          // Emit reconnected event so Dashboard can refresh state
          onEventRef.current({ event: "reconnected", data: { reason: "visibility_change" } });
        }
      }
    };

    // Handle online/offline events - mobile networks are unreliable
    const handleOnline = () => {
      if (!active) return;
      console.debug("[SSE] Network came online");
      const isConnectionMissing = !eventSourceRef.current;
      if (isConnectionMissing) {
        reconnect("network came online");
        onEventRef.current({ event: "reconnected", data: { reason: "network_online" } });
      }
    };

    connect();

    // Add visibility change listener for mobile background/foreground
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);

    return () => {
      active = false;
      clearRetryTimeout();
      clearConnectionCheck();
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
    };
  }, [baseUrl]);
}
