import { type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';

/** A cell of the grid: a night on a unit row (or on a property row for whole stays). */
export interface CellRef {
  propertyId: string;
  /** Unit row id; null on the property row of a `rooms` property (= whole place). */
  unitId: string | null;
  night: string;
  /** Room rows can be combined with ctrl/cmd-click. */
  room: boolean;
}

/** `start`..`end` are inclusive nights; check-out is the night after `end`. */
export interface CalendarSelection {
  propertyId: string;
  unitIds: string[];
  whole: boolean;
  start: string;
  end: string;
  complete: boolean;
}

export interface SelectModifiers {
  shift?: boolean;
  multi?: boolean;
}

/** Selection modifiers of a click: shift extends, ctrl/cmd adds rooms. */
export function modifiers(
  e: Pick<MouseEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>,
): SelectModifiers {
  return { shift: e.shiftKey, multi: e.ctrlKey || e.metaKey };
}

/** True when the cell is on the same target as the selection (the whole place, or its rooms). */
function sameTarget(current: CalendarSelection, cell: CellRef, multi: boolean): boolean {
  if (current.propertyId !== cell.propertyId) return false;
  if (current.whole) return !cell.room;
  if (!cell.room || !cell.unitId) return false;
  return multi || current.unitIds.includes(cell.unitId);
}

function fresh(cell: CellRef): CalendarSelection {
  return {
    propertyId: cell.propertyId,
    unitIds: cell.room && cell.unitId ? [cell.unitId] : [],
    whole: !cell.room,
    start: cell.night,
    end: cell.night,
    complete: false,
  };
}

/** Pure selection step: first click starts, a later click on the same property ends. */
export function nextSelection(
  current: CalendarSelection | null,
  cell: CellRef,
  mods: SelectModifiers = {},
): CalendarSelection {
  // A click on another target (whole place vs room, or another room without ctrl/cmd) restarts.
  const same = current ? sameTarget(current, cell, Boolean(mods.multi)) : false;
  if (current && same && mods.multi && cell.room && cell.unitId && !current.whole) {
    const has = current.unitIds.includes(cell.unitId);
    const unitIds = has
      ? current.unitIds.filter((u) => u !== cell.unitId)
      : [...current.unitIds, cell.unitId];
    return unitIds.length ? { ...current, unitIds } : fresh(cell);
  }
  if (current && same && (!current.complete || mods.shift)) {
    if (cell.night < current.start)
      return mods.shift ? { ...current, start: cell.night, complete: true } : fresh(cell);
    return { ...current, end: cell.night, complete: true };
  }
  return fresh(cell);
}

/**
 * Grid selection: click a free night to start, click (or shift-click, or drag to) a later
 * night on the same property to end; ctrl/cmd-click adds rooms; Esc clears. A completed
 * selection is handed to `onComplete` (the page opens the booking sheet).
 */
export function useCalendarSelection(onComplete: (selection: CalendarSelection) => void) {
  const [selection, setSelection] = useState<CalendarSelection | null>(null);
  const drag = useRef<{
    origin: CellRef;
    moved: boolean;
    range: CalendarSelection | null;
  } | null>(null);
  const suppressClick = useRef(false);
  const latest = useRef(selection);
  latest.current = selection;
  const complete = useRef(onComplete);
  complete.current = onComplete;

  const apply = useCallback((next: CalendarSelection) => {
    setSelection(next);
    if (next.complete) complete.current(next);
  }, []);

  const select = useCallback(
    (cell: CellRef, mods: SelectModifiers = {}) => {
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      apply(nextSelection(latest.current, cell, mods));
    },
    [apply],
  );

  const pointerDown = useCallback((cell: CellRef) => {
    drag.current = { origin: cell, moved: false, range: null };
  }, []);

  const pointerEnter = useCallback((cell: CellRef) => {
    const d = drag.current;
    if (!d || cell.propertyId !== d.origin.propertyId || cell.room !== d.origin.room) return;
    if (cell.night === d.origin.night && !d.moved) return;
    d.moved = true;
    const [start, end] =
      cell.night < d.origin.night ? [cell.night, d.origin.night] : [d.origin.night, cell.night];
    // The range lives on the drag itself, so the release completes exactly what was dragged
    // even when React has not rendered the last move yet.
    d.range = { ...fresh(d.origin), start, end };
    setSelection(d.range);
  }, []);

  const pointerUp = useCallback(() => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved || !d.range) return;
    suppressClick.current = true;
    apply({ ...d.range, complete: true });
  }, [apply]);

  const clear = useCallback(() => {
    drag.current = null;
    setSelection(null);
  }, []);

  useEffect(() => {
    const up = () => {
      if (drag.current) pointerUp();
      // A click event follows only when the pointer was released on a cell.
      window.setTimeout(() => (suppressClick.current = false), 0);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && latest.current && !latest.current.complete) clear();
    };
    // A cancelled pointer (native drag, scroll, lost focus) never releases: forget the drag so
    // a later click does not complete a stale range.
    const cancel = () => {
      if (!drag.current) return;
      drag.current = null;
      if (latest.current && !latest.current.complete) setSelection(null);
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', esc);
    };
  }, [pointerUp, clear]);

  return { selection, select, pointerDown, pointerEnter, clear };
}
