"use client";

import { GripVertical } from "lucide-react";
import { useRef } from "react";
import { studioSidebarMaxWidth, studioSidebarMinWidth } from "@/lib/studio/organization";

const clamp = (width: number, max = studioSidebarMaxWidth) =>
  Math.min(max, Math.max(studioSidebarMinWidth, Math.round(width)));

export function SidebarResize({ width, side, disabled, onCommit }: {
  width: number;
  side: "left" | "right";
  disabled: boolean;
  onCommit: (width: number) => void;
}) {
  const drag = useRef<{ pointer: number; x: number; width: number; max: number; grid: HTMLElement } | null>(null);
  const direction = side === "left" ? 1 : -1;

  function preview(grid: HTMLElement, handle: HTMLElement, next: number) {
    grid.style.setProperty("--studio-navigation-width", `${next}px`);
    handle.setAttribute("aria-valuenow", String(next));
  }

  function cancel(pointer: number, handle: HTMLElement) {
    const start = drag.current;
    if (start?.pointer !== pointer) return;
    drag.current = null;
    preview(start.grid, handle, width);
  }

  return <div className="studio-sidebar-resize" role="separator" tabIndex={disabled ? -1 : 0}
    aria-label="Resize Projects sidebar" aria-orientation="vertical" aria-controls="studio-project-navigation"
    aria-disabled={disabled} aria-valuemin={studioSidebarMinWidth} aria-valuemax={studioSidebarMaxWidth} aria-valuenow={width}
    title="Drag to resize, or use the arrow keys"
    onPointerDown={(event) => {
      if (disabled || event.button !== 0 || drag.current) return;
      const sidebar = event.currentTarget.parentElement;
      const grid = sidebar?.parentElement;
      if (!grid) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        pointer: event.pointerId, x: event.clientX, width: sidebar.getBoundingClientRect().width,
        max: clamp(Math.floor(grid.clientWidth * 0.45)), grid,
      };
    }}
    onPointerMove={(event) => {
      const start = drag.current;
      if (start?.pointer === event.pointerId) {
        preview(start.grid, event.currentTarget, clamp(start.width + direction * (event.clientX - start.x), start.max));
      }
    }}
    onPointerUp={(event) => {
      const start = drag.current;
      if (start?.pointer !== event.pointerId) return;
      drag.current = null;
      const next = clamp(start.width + direction * (event.clientX - start.x), start.max);
      if (next === Math.round(start.width)) preview(start.grid, event.currentTarget, width);
      else {
        preview(start.grid, event.currentTarget, next);
        onCommit(next);
      }
    }}
    onPointerCancel={(event) => cancel(event.pointerId, event.currentTarget)}
    onLostPointerCapture={(event) => cancel(event.pointerId, event.currentTarget)}
    onKeyDown={(event) => {
      if (event.key === "Escape" && drag.current) {
        cancel(drag.current.pointer, event.currentTarget);
        return;
      }
      if (disabled || drag.current) return;
      const step = event.shiftKey ? 32 : 16;
      let next: number;
      switch (event.key) {
        case "ArrowLeft": next = width - direction * step; break;
        case "ArrowRight": next = width + direction * step; break;
        case "Home": next = studioSidebarMinWidth; break;
        case "End": next = studioSidebarMaxWidth; break;
        default: return;
      }
      event.preventDefault();
      const normalized = clamp(next);
      if (normalized !== width) onCommit(normalized);
    }}>
    <GripVertical size={14} aria-hidden />
  </div>;
}
