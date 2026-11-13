import { useEffect, useState } from 'react';

/** How much of the launcher stays visible when tucked against the screen edge (px). */
export const TUCKED_VISIBLE = 14;

/**
 * Whether the launcher should tuck against the right edge (TM-13): on a padded page that is
 * scrolled somewhere in the middle, the content below the launcher is not the page's end, so at
 * full size it would cover a value, a status or a note there. At the end of the page the spacer
 * (`data-assistant-spacer`, 80 px) keeps the room free, and a page that does not scroll ends
 * above the spacer, so in both cases the launcher shows in full. Full-bleed pages (no visible
 * spacer) mark their bottom-right controls instead and never tuck, unless they leave a right
 * gutter for it and say so with `data-assistant-tuck` (the bot space).
 */
export function shouldTuck(page: {
  scrollY: number;
  viewport: number;
  scrollHeight: number;
  spacer: number;
}): boolean {
  if (page.spacer <= 0) return false;
  const below = page.scrollHeight - page.scrollY - page.viewport;
  return below > page.spacer;
}

export function useLauncherTucked(active: boolean): boolean {
  const [tucked, setTucked] = useState(false);
  useEffect(() => {
    if (!active) {
      setTucked(false);
      return;
    }
    let frame = 0;
    const measure = () => {
      frame = 0;
      const spacer = document.querySelector<HTMLElement>('[data-assistant-spacer]');
      // A full-bleed page with a right gutter for it asks to keep the launcher tucked (TM3-11).
      if (document.querySelector('[data-assistant-tuck]')) {
        setTucked(true);
        return;
      }
      setTucked(
        shouldTuck({
          scrollY: window.scrollY,
          viewport: window.innerHeight,
          scrollHeight: document.documentElement.scrollHeight,
          spacer: spacer?.offsetHeight ?? 0,
        }),
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer.disconnect();
    };
  }, [active]);
  return tucked;
}
