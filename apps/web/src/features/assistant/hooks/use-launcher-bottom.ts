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

function overlaps(a: DOMRect, b: { left: number; right: number; top: number; bottom: number }) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * How far (px from the viewport bottom) the launcher sits: `LAUNCHER_INSET`, or just above every
 * marked element that would be under it at rest. Recomputed on scroll, resize and DOM changes
 * (one measure per animation frame).
 */
export function useLauncherBottom(enabled: boolean): number {
  const [bottom, setBottom] = useState(LAUNCHER_INSET);
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const vw = document.documentElement.clientWidth || window.innerWidth;
      const vh = window.innerHeight;
      const rest = {
        left: vw - LAUNCHER_INSET - LAUNCHER_SIZE - GAP,
        right: vw - LAUNCHER_INSET + GAP,
        top: vh - LAUNCHER_INSET - LAUNCHER_SIZE - GAP,
        bottom: vh - LAUNCHER_INSET + GAP,
      };
      let next = LAUNCHER_INSET;
      for (const el of document.querySelectorAll(`[${ASSISTANT_AVOID_ATTR}]`)) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0 || !overlaps(rect, rest)) continue;
        next = Math.max(next, vh - rect.top + GAP);
      }
      // Never off the top of the screen.
      next = Math.min(next, Math.max(LAUNCHER_INSET, vh - LAUNCHER_SIZE - LAUNCHER_INSET));
      setBottom(next);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
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
    };
  }, [enabled]);
  return bottom;
}
