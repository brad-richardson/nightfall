"use client";

import React, { useEffect, useState, useRef } from "react";

export type FeedItem = {
  event_type: string;
  region_id: string | null;
  message: string;
  ts: string;
};

type ActivityFeedProps = {
  initialItems?: FeedItem[];
};

export default function ActivityFeed({ initialItems = [] }: ActivityFeedProps) {
  const [items, setItems] = useState<FeedItem[]>(initialItems);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleNewItem = (e: CustomEvent<FeedItem>) => {
      setItems((prev) => [e.detail, ...prev].slice(0, 50));
    };

    window.addEventListener("nightfall:feed_item" as any, handleNewItem);
    return () => window.removeEventListener("nightfall:feed_item" as any, handleNewItem);
  }, []);

  return (
    <div className="relative flex h-10 w-full items-center overflow-hidden border-t border-white/5 bg-black/40 backdrop-blur-md">
      <div className="flex shrink-0 items-center px-4">
        <span className="flex h-2 w-2 animate-pulse rounded-full bg-[color:var(--night-teal)] shadow-[0_0_8px_var(--night-teal)]" />
        <span className="ml-3 text-[10px] font-bold uppercase tracking-[0.3em] text-[color:var(--night-ash)]">
          Live Feed
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
          ) : (
            <span className="text-xs tracking-wider text-white/40 uppercase">
              No recent activity. All systems nominal.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
