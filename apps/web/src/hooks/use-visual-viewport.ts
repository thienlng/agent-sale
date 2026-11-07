import { type CSSProperties, useEffect, useState } from 'react';

/**
 * Position for a full-height fixed panel that must stay inside the part of the screen the user
 * sees. iOS Safari keeps the layout viewport when the keyboard opens and scrolls it instead, which
 * pushed the panel's header under the status bar and could leave it there after the keyboard
 * closed. Returns `{ top, height }` of the visual viewport while `active`, otherwise nothing.
 */
export function useVisualViewportBox(active: boolean): CSSProperties | undefined {
  const [box, setBox] = useState<CSSProperties | undefined>(undefined);
  useEffect(() => {
    const vv = typeof window === 'undefined' ? undefined : window.visualViewport;
    if (!active || !vv) {
      setBox(undefined);
      return;
    }
    const update = () => setBox({ top: vv.offsetTop, height: vv.height, bottom: 'auto' });
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [active]);
  return box;
}
