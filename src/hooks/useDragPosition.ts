"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Position {
  x: number;
  y: number;
}

interface UseDragPositionOptions {
  defaultRight?: number;
  defaultTop?: number;
}

export function useDragPosition(options: UseDragPositionOptions = {}) {
  const { defaultRight = 16, defaultTop = 64 } = options;
  const [position, setPosition] = useState<Position | null>(null);
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const movedRef = useRef(false);

  const getDefaultPosition = useCallback((): Position => {
    return {
      x: window.innerWidth - defaultRight - 120,
      y: defaultTop,
    };
  }, [defaultRight, defaultTop]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const current = position ?? getDefaultPosition();
      dragState.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: current.x,
        origY: current.y,
      };
      movedRef.current = false;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [position, getDefaultPosition]
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      movedRef.current = true;
    }
    const maxX = window.innerWidth - 80;
    const maxY = window.innerHeight - 40;
    setPosition({
      x: Math.max(8, Math.min(maxX, dragState.current.origX + dx)),
      y: Math.max(8, Math.min(maxY, dragState.current.origY + dy)),
    });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragState.current = null;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }, []);

  const wasDragged = useCallback(() => movedRef.current, []);

  const resetMoved = useCallback(() => {
    movedRef.current = false;
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setPosition((prev) => {
        if (!prev) return prev;
        return {
          x: Math.min(prev.x, window.innerWidth - 80),
          y: Math.min(prev.y, window.innerHeight - 40),
        };
      });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const style: React.CSSProperties = position
    ? { left: position.x, top: position.y, right: "auto", bottom: "auto" }
    : { top: defaultTop, right: defaultRight, left: "auto", bottom: "auto" };

  return {
    style,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    wasDragged,
    resetMoved,
  };
}
