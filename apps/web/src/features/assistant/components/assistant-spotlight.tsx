import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useAssistantUi } from '../stores/assistant-ui.store';

/** How long to wait for the target to appear (e.g. after a navigate) before giving up. */
const FIND_TIMEOUT_MS = 3000;
const GAP = 8;
const HINT_WIDTH = 288;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

function sameBox(a: Box | null, b: Box): boolean {
  return (
    !!a && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height
  );
}

function escapeId(id: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/["\\]/g, '\\$&');
}

/**
 * Points at a control for the owner: finds `[data-assistant-target="<id>"]`, scrolls it into
 * view and draws a ring (token `--primary`) with the assistant's hint next to it. The overlay
 * follows the element; a click anywhere or Esc dismisses it. It never takes or traps focus.
 */
export function AssistantSpotlight() {
  const { t } = useTranslation('assistant');
  const spotlight = useAssistantUi((s) => s.spotlight);
  const setSpotlight = useAssistantUi((s) => s.setSpotlight);
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => {
    setBox(null);
    if (!spotlight) return;
    const selector = `[data-assistant-target="${escapeId(spotlight.target)}"]`;
    const started = Date.now();
    let scrolled = false;
    let frame = 0;
    const tick = () => {
      // Prefer a visible match: a hidden copy (e.g. a collapsed mobile toolbar) has no box.
      const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
      const el = nodes.find((node) => node.getClientRects().length > 0) ?? nodes[0];
      if (!el) {
        if (Date.now() - started > FIND_TIMEOUT_MS) {
          setSpotlight(null);
          return;
        }
      } else {
        if (!scrolled) {
          scrolled = true;
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        const r = el.getBoundingClientRect();
        const next = { top: r.top, left: r.left, width: r.width, height: r.height };
        setBox((prev) => (sameBox(prev, next) ? prev : next));
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [spotlight, setSpotlight]);

  useEffect(() => {
    if (!spotlight) return;
    const dismiss = () => setSpotlight(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    // Capture, and no preventDefault: the click still reaches what the owner clicked.
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [spotlight, setSpotlight]);

  if (!spotlight || !box) return null;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const width = Math.min(HINT_WIDTH, viewportW - 2 * 16);
  const left = Math.max(16, Math.min(box.left, viewportW - width - 16));
  const below = box.top + box.height + GAP;
  const placeBelow = below + 96 < viewportH || box.top < 120;

  return createPortal(
    <>
      <div
        aria-hidden
        data-testid="assistant-spotlight-ring"
        className="pointer-events-none fixed z-[60] rounded-lg ring-3 ring-primary ring-offset-2 ring-offset-background transition-all"
        style={{
          top: box.top - 4,
          left: box.left - 4,
          width: box.width + 8,
          height: box.height + 8,
        }}
      />
      <div
        role="status"
        className="pointer-events-none fixed z-[60] rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
        style={{
          width,
          left,
          ...(placeBelow ? { top: below } : { bottom: viewportH - box.top + GAP }),
        }}
      >
        <p className="whitespace-pre-line">{spotlight.hint}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t('spotlightDismiss')}</p>
      </div>
    </>,
    document.body,
  );
}
