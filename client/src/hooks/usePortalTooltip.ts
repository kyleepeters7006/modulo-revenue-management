import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Placement of a portalled hover tooltip, in viewport coordinates.
 */
export interface PortalTooltipPos {
  top: number;
  left: number;
  /** Arrow offset from the card's left edge, so it sits under the anchor's centre. */
  arrowLeft: number;
  /** Which edge the arrow hangs off, or null when the card had to be clamped across the anchor. */
  arrowSide: 'top' | 'bottom' | null;
}

interface Options {
  /** Whether the containing dialog is open. Closing resets all hover state. */
  open: boolean;
  /** Gap between the anchor and the card. */
  gap?: number;
  /** Minimum distance kept from the viewport edges. */
  margin?: number;
}

/**
 * Positions a hover tooltip that is rendered through a portal on document.body.
 *
 * Tooltips that live inside a scrollable dialog are clipped by that dialog's
 * overflow box, and when the card is taller than the room on either side of the
 * anchor no amount of above/below flipping can keep it fully visible. Portalling
 * the card out of the dialog removes the clip; this hook then measures its real
 * rendered size and clamps the position to the viewport instead.
 *
 * Usage: attach `scrollRef` to the dialog's scroll container, `tipRef` to the
 * portalled card, and wire `onAnchorEnter(id)` / `onAnchorLeave` to the anchors.
 */
export function usePortalTooltip({ open, gap = 10, margin = 8 }: Options) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pos, setPos] = useState<PortalTooltipPos | null>(null);
  /** The scrollable dialog body, so the card can follow the anchor as it scrolls. */
  const scrollRef = useRef<HTMLDivElement>(null);
  /** The portalled card itself, measured for its true height/width. */
  const tipRef = useRef<HTMLDivElement>(null);
  /** The hovered anchor element. */
  const anchorRef = useRef<HTMLElement | null>(null);

  const position = useCallback(() => {
    const anchor = anchorRef.current;
    const tip = tipRef.current;
    if (!anchor || !tip) return;
    const a = anchor.getBoundingClientRect();
    const t = tip.getBoundingClientRect();

    // Prefer above the anchor, fall back to below, then clamp into the viewport.
    let top = a.top - t.height - gap;
    if (top < margin) top = a.bottom + gap;
    if (top + t.height > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - margin - t.height);
    }

    const centre = a.left + a.width / 2;
    let left = centre - t.width / 2;
    left = Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - margin - t.width));

    // Only draw the arrow when the card ended up cleanly above or below the
    // anchor; after clamping it can overlap, where an arrow would point at nothing.
    const arrowSide: 'top' | 'bottom' | null =
      top + t.height <= a.top ? 'bottom' : top >= a.bottom ? 'top' : null;
    const arrowLeft = Math.min(Math.max(centre - left, 14), Math.max(14, t.width - 14));

    setPos({ top, left, arrowLeft, arrowSide });
  }, [gap, margin]);

  // Closing the dialog unmounts the anchors and the portal but would otherwise
  // leave hoveredId set, so reopening would show a stale card pinned to the last
  // measured position against a detached anchor.
  useEffect(() => {
    if (open) return;
    setHoveredId(null);
    setPos(null);
    anchorRef.current = null;
  }, [open]);

  // Measure and place before paint so the card is never seen in the wrong spot.
  useLayoutEffect(() => {
    if (!open || !hoveredId) {
      setPos(null);
      return;
    }
    position();
  }, [open, hoveredId, position]);

  // The card is viewport-positioned, so it has to be re-placed whenever the
  // anchor can move under a stationary pointer. Window scroll is captured so
  // scrolling in any ancestor is picked up too.
  useEffect(() => {
    if (!open || !hoveredId) return;
    const onReflow = () => position();
    const scroller = scrollRef.current;
    scroller?.addEventListener('scroll', onReflow, { passive: true });
    window.addEventListener('scroll', onReflow, { passive: true, capture: true });
    window.addEventListener('resize', onReflow);
    return () => {
      scroller?.removeEventListener('scroll', onReflow);
      window.removeEventListener('scroll', onReflow, { capture: true });
      window.removeEventListener('resize', onReflow);
    };
  }, [open, hoveredId, position]);

  const onAnchorEnter = useCallback((id: string) => (e: React.MouseEvent<HTMLElement>) => {
    anchorRef.current = e.currentTarget;
    setHoveredId(id);
  }, []);

  const onAnchorLeave = useCallback(() => {
    anchorRef.current = null;
    setHoveredId(null);
  }, []);

  return { hoveredId, pos, scrollRef, tipRef, onAnchorEnter, onAnchorLeave };
}
