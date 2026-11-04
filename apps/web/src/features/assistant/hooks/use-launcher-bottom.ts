import { useEffect, useState } from 'react';

/** The launcher's resting place: `right-4 bottom-4`, `size-14`. */
export const LAUNCHER_INSET = 16;
const LAUNCHER_SIZE = 56;
/** Space kept between the launcher and the element it steps over. */
const GAP = 8;

/**
 * Pages mark a bottom-right control the launcher must not cover (a chat composer with its Send
 * button, a sticky save bar) with this attribute. Only short elements should carry it: the
 * launcher moves up above the element, so marking a tall one would push it far up.
 */
export const ASSISTANT_AVOID_ATTR = 'data-assistant-avoid';

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function overlaps(a: Box, b: Box) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * The launcher's bottom offset (px) given the marked elements' rects: start at rest and, while
 * the launcher (at its current, lifted place, with a gap) overlaps a marked element, step above
 * it. Re-checking at the lifted place matters: stepping over a composer can land the launcher on
 * the chips above it (OV1). Never off the top of the screen.
 */
export function launcherBottomFor(rects: readonly Box[], vw: number, vh: number): number {
  const ceiling = Math.max(LAUNCHER_INSET, vh - LAUNCHER_SIZE - LAUNCHER_INSET);
  const shown = rects.filter((r) => r.right > r.left && r.bottom > r.top);
  let bottom = LAUNCHER_INSET;
  // Each pass lifts the launcher above at least one more element, so this ends.
  for (let pass = 0; pass <= shown.length; pass++) {
    const at: Box = {
      left: vw - LAUNCHER_INSET - LAUNCHER_SIZE - GAP,
      right: vw - LAUNCHER_INSET + GAP,
      top: vh - bottom - LAUNCHER_SIZE - GAP,
      bottom: vh - bottom + GAP,
    };
    let next = bottom;
    for (const rect of shown) {
      if (overlaps(rect, at)) next = Math.max(next, vh - rect.top + GAP);
    }
    next = Math.min(next, ceiling);
    if (next === bottom) break;
    bottom = next;
  }
  return bottom;
}

/**
 * How far (px from the viewport bottom) the launcher sits: `LAUNCHER_INSET`, or just above the
 * marked elements it would cover (see `launcherBottomFor`). Recomputed on scroll, resize, DOM
 * changes and when a marked element changes size (one measure per animation frame).
 */
export function useLauncherBottom(enabled: boolean): number {
  const [bottom, setBottom] = useState(LAUNCHER_INSET);
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    let resizes: ResizeObserver | null = null;
    let observed = new Set<Element>();
    const measure = () => {
      frame = 0;
      const vw = document.documentElement.clientWidth || window.innerWidth;
      const marked = Array.from(document.querySelectorAll(`[${ASSISTANT_AVOID_ATTR}]`));
      // A marked element can grow without a DOM change on it (chips wrap, text loads). Observe
      // only the new ones: observing again would report at once and measure in a loop.
      if (resizes) {
        for (const el of observed) if (!marked.includes(el)) resizes.unobserve(el);
        for (const el of marked) if (!observed.has(el)) resizes.observe(el);
        observed = new Set(marked);
      }
      const rects = marked.map((el) => el.getBoundingClientRect());
      setBottom(launcherBottomFor(rects, vw, window.innerHeight));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    if (typeof ResizeObserver !== 'undefined') resizes = new ResizeObserver(schedule);
    schedule();
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [ASSISTANT_AVOID_ATTR, 'class', 'style', 'hidden'],
    });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      observer.disconnect();
      resizes?.disconnect();
    };
  }, [enabled]);
  return bottom;
}
