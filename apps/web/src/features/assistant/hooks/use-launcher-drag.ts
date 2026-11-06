import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { storage } from '@/lib/storage';

/** Where the owner left the launcher, per browser. */
export const LAUNCHER_POSITION_KEY = 'rapiz.assistant.launcherPosition';
const SIZE = 56;
/** The launcher never comes closer than this to a viewport edge. */
const MARGIN = 8;
/** A press that moves less than this is a click, not a drag (a shaky finger still opens). */
const DRAG_THRESHOLD = 5;
/** One Alt+arrow press moves the launcher this far. */
const KEY_STEP = 24;

/** The launcher's offsets from the viewport's right and bottom edges (px). */
export interface LauncherPosition {
  right: number;
  bottom: number;
}

const viewport = () => ({
  vw: document.documentElement.clientWidth || window.innerWidth,
  vh: window.innerHeight,
});

/** Keeps the whole launcher on screen, `MARGIN` from every edge. */
export function clampLauncher(p: LauncherPosition, vw: number, vh: number): LauncherPosition {
  const clamp = (v: number, max: number) =>
    Math.round(Math.min(Math.max(v, MARGIN), Math.max(MARGIN, max - SIZE - MARGIN)));
  return { right: clamp(p.right, vw), bottom: clamp(p.bottom, vh) };
}

function readSaved(): LauncherPosition | null {
  const raw = storage.get(LAUNCHER_POSITION_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<LauncherPosition>;
    if (typeof v.right === 'number' && typeof v.bottom === 'number')
      return { right: v.right, bottom: v.bottom };
  } catch {
    // ignored: a corrupt value means the default place
  }
  return null;
}

const save = (p: LauncherPosition) => storage.set(LAUNCHER_POSITION_KEY, JSON.stringify(p));

interface Press {
  pointerId: number;
  x: number;
  y: number;
  start: LauncherPosition;
  dragging: boolean;
  /** Where the drag has taken the launcher so far. */
  last: LauncherPosition | null;
}

/**
 * Lets the owner drag the launcher anywhere (mouse, touch, pen) or move it with Alt+arrows,
 * e.g. off a page's own control. `null` = never moved: the caller keeps its default place.
 * A press that moved past the threshold never counts as a click.
 */
export function useLauncherDrag(onClick: () => void) {
  const [position, setPosition] = useState<LauncherPosition | null>(() => {
    const saved = readSaved();
    if (!saved) return null;
    const { vw, vh } = viewport();
    return clampLauncher(saved, vw, vh);
  });
  const [dragging, setDragging] = useState(false);
  const press = useRef<Press | null>(null);
  const suppressClick = useRef(false);

  // A smaller window (rotation, split screen) must not push a moved launcher off screen.
  const moved = position !== null;
  useEffect(() => {
    if (!moved) return;
    const reclamp = () => {
      const { vw, vh } = viewport();
      setPosition((p) => (p ? clampLauncher(p, vw, vh) : p));
    };
    window.addEventListener('resize', reclamp);
    return () => window.removeEventListener('resize', reclamp);
  }, [moved]);

  const onPointerDown = useCallback((e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const { vw, vh } = viewport();
    press.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      start: { right: vw - rect.right, bottom: vh - rect.bottom },
      dragging: false,
      last: null,
    };
    suppressClick.current = false;
    // A fast drag leaves the button at once: keep its moves and the release coming here.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignored: without capture a drag only follows while the pointer is over the button
    }
  }, []);

  const onPointerMove = useCallback((e: PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      p.dragging = true;
      setDragging(true);
    }
    const { vw, vh } = viewport();
    p.last = clampLauncher({ right: p.start.right - dx, bottom: p.start.bottom - dy }, vw, vh);
    setPosition(p.last);
  }, []);

  const endPress = useCallback((e: PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    press.current = null;
    if (!p.dragging) return;
    // The click that follows the release of a drag must not open the panel.
    suppressClick.current = true;
    setDragging(false);
    if (p.last) save(p.last);
  }, []);

  const handleClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      if (suppressClick.current) {
        suppressClick.current = false;
        e.preventDefault();
        return;
      }
      onClick();
    },
    [onClick],
  );

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLButtonElement>) => {
    if (!e.altKey) return;
    const step: Record<string, [number, number]> = {
      ArrowLeft: [KEY_STEP, 0],
      ArrowRight: [-KEY_STEP, 0],
      ArrowUp: [0, KEY_STEP],
      ArrowDown: [0, -KEY_STEP],
    };
    const by = step[e.key];
    if (!by) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const { vw, vh } = viewport();
    const next = clampLauncher(
      { right: vw - rect.right + by[0], bottom: vh - rect.bottom + by[1] },
      vw,
      vh,
    );
    setPosition(next);
    save(next);
  }, []);

  return {
    position,
    dragging,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endPress,
      onPointerCancel: endPress,
      onClick: handleClick,
      onKeyDown,
    },
  };
}
