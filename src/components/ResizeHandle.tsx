"use client";

import { useCallback, useEffect, useRef } from "react";
import clsx from "clsx";

interface ResizeHandleProps {
  direction: "horizontal" | "vertical";
  onResize: (delta: number) => void;
  className?: string;
}

export function ResizeHandle({ direction, onResize, className }: ResizeHandleProps) {
  const dragging = useRef(false);
  const lastPos = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    lastPos.current = direction === "horizontal" ? e.clientX : e.clientY;
    document.body.style.cursor = direction === "horizontal" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  }, [direction]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const current = direction === "horizontal" ? e.clientX : e.clientY;
      const delta = current - lastPos.current;
      lastPos.current = current;
      onResize(delta);
    };

    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [direction, onResize]);

  return (
    <div
      onMouseDown={onMouseDown}
      className={clsx(
        "shrink-0 z-10 group flex items-center justify-center",
        direction === "horizontal"
          ? "w-1 cursor-col-resize hover:bg-[var(--accent)]/30 active:bg-[var(--accent)]/50"
          : "h-1.5 cursor-row-resize hover:bg-[var(--accent)]/30 active:bg-[var(--accent)]/50",
        className
      )}
    >
      <div
        className={clsx(
          "rounded-full bg-[var(--panel-border)] group-hover:bg-[var(--accent)]/60 transition-colors",
          direction === "horizontal" ? "w-px h-8" : "h-px w-8"
        )}
      />
    </div>
  );
}
