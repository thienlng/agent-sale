import { useCallback, useEffect, useRef, useState } from 'react';

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
  const same = current?.propertyId === cell.propertyId;
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
  const drag = useRef<{ origin: CellRef; moved: boolean } | null>(null);
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
    drag.current = { origin: cell, moved: false };
  }, []);

  const pointerEnter = useCallback((cell: CellRef) => {
    const d = drag.current;
    if (!d || cell.propertyId !== d.origin.propertyId || cell.night === d.origin.night) return;
    d.moved = true;
    const base = fresh(d.origin);
    const [start, end] =
      cell.night < d.origin.night ? [cell.night, d.origin.night] : [d.origin.night, cell.night];
    setSelection({ ...base, start, end });
  }, []);

  const pointerUp = useCallback(() => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved || !latest.current) return;
    suppressClick.current = true;
    apply({ ...latest.current, complete: true });
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
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', esc);
    };
  }, [pointerUp, clear]);

  return { selection, select, pointerDown, pointerEnter, clear };
}
