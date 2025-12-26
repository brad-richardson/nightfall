"use client";

import React from "react";
import { Drawer } from "vaul";
import { ChevronUp } from "lucide-react";

type MobileSidebarProps = {
  children: React.ReactNode;
};

export default function MobileSidebar({ children }: MobileSidebarProps) {
  return (
    <Drawer.Root shouldScaleBackground>
      <Drawer.Trigger asChild>
        <button className="flex w-full items-center justify-center gap-2 rounded-t-3xl border-t border-white/10 bg-[color:var(--night-ink)]/90 py-3 text-white backdrop-blur-xl lg:hidden">
          <ChevronUp className="h-4 w-4 text-[color:var(--night-teal)]" />
          <span className="text-[10px] font-bold uppercase tracking-[0.3em]">Region Status & Tasks</span>
        </button>
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40" />
        <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 flex max-h-[96%] flex-col rounded-t-[32px] bg-[color:var(--night-sand)] outline-none">
          <div className="flex-1 overflow-y-auto rounded-t-[32px] bg-[color:var(--night-sand)] p-4">
            <div className="mx-auto mb-8 h-1.5 w-12 shrink-0 rounded-full bg-black/10" />
            <div className="mx-auto max-w-md space-y-6 pb-8">
              {children}
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
