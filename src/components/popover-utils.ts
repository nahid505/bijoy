"use client";

// Shared by the searchable pickers (SearchSelect, SearchableAccountSelect).
import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";

export function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export interface AnchoredPosition {
  left: number;
  top: number;
  width: number;
  /** opens upwards (not enough room below) — then `top` is the anchor's top edge */
  up: boolean;
}

/**
 * Fixed-position placement for a dropdown attached to `anchor`, kept in place on scroll / resize.
 * Fixed positioning means scrolling tables (overflow-x-auto) never clip the list.
 */
export function useAnchoredPosition(anchor: RefObject<HTMLElement | null>, open: boolean, minWidth: number, needed = 300) {
  const [pos, setPos] = useState<AnchoredPosition | null>(null);
  const place = useCallback(() => {
    const el = anchor.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, minWidth), window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const up = window.innerHeight - r.bottom < needed && r.top > needed;
    setPos({ left, top: up ? r.top - 4 : r.bottom + 4, width, up });
  }, [anchor, minWidth, needed]);
  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);
  return pos;
}

/** inline style for a fixed dropdown at `pos` */
export const anchoredStyle = (pos: AnchoredPosition) =>
  ({ position: "fixed", left: pos.left, width: pos.width, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }) as const;
