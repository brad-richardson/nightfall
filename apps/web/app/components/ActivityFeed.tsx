"use client";

import React, { useEffect, useState } from "react";

export type FeedItem = {
  event_type: string;
  region_id: string | null;
  message: string;
  ts: string;
};

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

type ActivityFeedProps = {
  initialItems?: FeedItem[];
};

export default function ActivityFeed({ initialItems = [] }: ActivityFeedProps) {
  const [items, setItems] = useState<FeedItem[]>(initialItems);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [lastEventTime, setLastEventTime] = useState<number>(Date.now());

  useEffect(() => {
    const handleNewItem = (e: Event) => {
      const customEvent = e as CustomEvent<FeedItem>;
      setItems((prev) => [customEvent.detail, ...prev].slice(0, 50));
      setConnectionStatus("connected");
      setLastEventTime(Date.now());
    };

    // Listen for SSE connection status events
    const handleConnected = () => {
      setConnectionStatus("connected");
    };

    const handleDisconnected = () => {
      setConnectionStatus("disconnected");
    };

    const handleError = () => {
      setConnectionStatus("error");
    };

    window.addEventListener("nightfall:feed_item", handleNewItem);
    window.addEventListener("nightfall:sse_connected", handleConnected);
    window.addEventListener("nightfall:sse_disconnected", handleDisconnected);
    window.addEventListener("nightfall:sse_error", handleError);

    return () => {
      window.removeEventListener("nightfall:feed_item", handleNewItem);
      window.removeEventListener("nightfall:sse_connected", handleConnected);
      window.removeEventListener("nightfall:sse_disconnected", handleDisconnected);
      window.removeEventListener("nightfall:sse_error", handleError);
    };
  }, []);

  // Check for stale connection (no events in 60 seconds)
  useEffect(() => {
    const interval = setInterval(() => {
      if (connectionStatus === "connected" && Date.now() - lastEventTime > 60000) {
        setConnectionStatus("disconnected");
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [connectionStatus, lastEventTime]);

  const getStatusIndicator = () => {
    switch (connectionStatus) {
      case "connected":
        return (
          <span className="flex h-2 w-2 animate-pulse rounded-full bg-[color:var(--night-teal)] shadow-[0_0_8px_var(--night-teal)]" />
        );
      case "connecting":
        return (
          <span className="flex h-2 w-2 animate-pulse rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]" />
        );
      case "disconnected":
      case "error":
        return (
          <span className="flex h-2 w-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
        );
    }
  };

  const getStatusText = () => {
    switch (connectionStatus) {
      case "connected":
        return "Live Feed";
      case "connecting":
        return "Connecting...";
      case "disconnected":
        return "Reconnecting...";
      case "error":
        return "Connection Lost";
    }
  };

  return (
    <div className="relative flex h-10 w-full items-center overflow-hidden border-t border-white/5 bg-black/40 backdrop-blur-md">
      <div className="flex shrink-0 items-center px-4">
        {getStatusIndicator()}
        <span className="ml-3 text-[10px] font-bold uppercase tracking-[0.3em] text-[color:var(--night-ash)]">
          {getStatusText()}
        </span>
      </div>

      <div className="flex flex-1 items-center gap-8 overflow-hidden whitespace-nowrap px-4">
        <div className="flex animate-marquee gap-12 hover:[animation-play-state:paused]">
          {items.length > 0 ? (
            items.map((item, idx) => (
              <div key={item.ts + idx} className="flex items-center gap-3">
                <span className="text-[10px] tabular-nums text-white/30">
                  [{new Date(item.ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })}]
                </span>
                <span className="text-xs tracking-wider text-white/80 uppercase">
                  {item.message}
                </span>
              </div>
            ))
          ) : connectionStatus === "connected" ? (
            <span className="text-xs tracking-wider text-white/40 uppercase">
              All systems nominal. Awaiting activity...
            </span>
          ) : (
            <span className="text-xs tracking-wider text-white/40 uppercase">
              {connectionStatus === "connecting" ? "Establishing connection..." : "Attempting to reconnect..."}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
