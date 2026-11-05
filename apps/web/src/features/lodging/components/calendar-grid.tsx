import { type KeyboardEvent, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

import type { CalendarSelection } from '../hooks/use-calendar-selection';
import {
  type AvailabilityOptionData,
  type CalendarPropertyData,
  nightLabels,
  occupancy,
} from '../lib/calendar-model';
import { dayMonth, isoWeekday, weekdayShort } from '../lib/format';
import { type CellHandlers, PropertyBlock, rowsOf } from './calendar-property-block';

const FIRST_COL = 220;
const MIN_COL = 56;

const MOVES: Record<string, [number, number]> = {
  ArrowRight: [0, 1],
  ArrowLeft: [0, -1],
  ArrowDown: [1, 0],
  ArrowUp: [-1, 0],
};

/**
 * Desktop timeline: sticky header (weekday + date, weekend / special-day shading, today
 * ring), occupancy row, then one row group per property. Scrolls inside its own box, so the
 * page never overflows horizontally. Cells are buttons with a roving tabindex.
 */
export function CalendarGrid({
  properties,
  nights,
  today,
  expanded,
  fits,
  selection,
  handlers,
}: {
  properties: CalendarPropertyData[];
  nights: string[];
  today: string;
  expanded: ReadonlySet<string>;
  /** Best option per property while a search is shown; null = no search. */
  fits: Map<string, AvailabilityOptionData> | null;
  selection: CalendarSelection | null;
  handlers: CellHandlers;
}) {
  const { t } = useTranslation('lodging');
  const grid = useRef<HTMLDivElement>(null);
  const weekend = useMemo(() => nights.map((n) => isoWeekday(n) >= 6), [nights]);
  const labels = useMemo(() => nightLabels(properties, nights), [properties, nights]);
  const occ = useMemo(() => occupancy(properties, nights), [properties, nights]);

  // Exactly one cell is in the tab order; arrow keys move it.
  useEffect(() => {
    const root = grid.current;
    if (!root || root.querySelector('[data-c][tabindex="0"]')) return;
    root.querySelector<HTMLElement>('[data-c]')?.setAttribute('tabindex', '0');
  });

  const rove = (target: HTMLElement | null) => {
    if (!target) return;
    grid.current
      ?.querySelectorAll('[data-c][tabindex="0"]')
      .forEach((el) => el.setAttribute('tabindex', '-1'));
    target.setAttribute('tabindex', '0');
    target.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const move = MOVES[e.key];
    const current = (e.target as HTMLElement).closest<HTMLElement>('[data-c]');
    if (!move || !current) return;
    e.preventDefault();
    const r = Number(current.dataset['r']) + move[0];
    const c = Number(current.dataset['c']) + move[1];
    rove(grid.current?.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`) ?? null);
  };
  const onFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-c]');
    if (cell && cell.getAttribute('tabindex') !== '0') {
      grid.current
        ?.querySelectorAll('[data-c][tabindex="0"]')
        .forEach((el) => el.setAttribute('tabindex', '-1'));
      cell.setAttribute('tabindex', '0');
    }
  };

  let rowBase = 0;
  const style = {
    '--cal-cols': `${FIRST_COL}px repeat(${nights.length}, minmax(${MIN_COL}px, 1fr))`,
    minWidth: FIRST_COL + MIN_COL * nights.length,
  } as React.CSSProperties;

  return (
    <div
      ref={grid}
      role="grid"
      aria-label={t('cal.gridLabel')}
      className="max-h-[calc(100svh-14rem)] min-h-64 overflow-auto rounded-lg border border-border bg-background select-none"
      onKeyDown={onKeyDown}
      onFocus={onFocus}
    >
      <div style={style}>
        <div
          role="rowgroup"
          className="sticky top-0 z-[6] bg-background shadow-[0_1px_0_var(--border)]"
        >
          <div role="row" className="grid grid-cols-(--cal-cols)">
            <div
              role="columnheader"
              className="sticky left-0 z-[7] flex items-end bg-background px-2 pb-1 text-xs font-medium text-muted-foreground"
            >
              {t('cal.property')}
            </div>
            {nights.map((night, i) => (
              <div
                key={night}
                role="columnheader"
                className={cn(
                  'flex flex-col items-center justify-end gap-0.5 border-l border-border px-0.5 py-1 text-center tabular-nums',
                  weekend[i] && 'bg-muted',
                  night === today && 'rounded-t-md ring-2 ring-primary ring-inset',
                )}
              >
                {labels[i] && (
                  <span className="max-w-full truncate rounded-sm bg-primary-soft px-1 text-[11px] leading-4 font-medium text-primary-strong">
                    {labels[i]}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">{weekdayShort(t, night)}</span>
                <span
                  className={cn(
                    'text-[13px] font-medium',
                    night === today && 'text-primary-strong',
                  )}
                >
                  {dayMonth(night)}
                </span>
              </div>
            ))}
          </div>
          <div role="row" className="grid grid-cols-(--cal-cols) border-y border-border">
            <div
              role="rowheader"
              className="sticky left-0 z-[7] bg-background px-2 py-1 text-xs font-medium tabular-nums"
            >
              {t('cal.occupancy', { pct: occ.pct })}
            </div>
            {nights.map((night, i) => {
              const taken = occ.taken[i] ?? 0;
              return (
                <div
                  key={night}
                  role="gridcell"
                  aria-label={t('cal.occupancyNight', { taken, total: occ.total })}
                  className={cn(
                    'flex flex-col justify-center gap-0.5 border-l border-border px-1 py-1',
                    weekend[i] && 'bg-muted',
                  )}
                >
                  <span className="text-center text-[11px] leading-none tabular-nums text-muted-foreground">
                    {taken}/{occ.total}
                  </span>
                  <span className="h-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: `${occ.total ? Math.round((taken / occ.total) * 100) : 0}%` }}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        {properties.map((p) => {
          const base = rowBase;
          const open = expanded.has(p.id);
          rowBase += rowsOf(p, open);
          return (
            <PropertyBlock
              key={p.id}
              property={p}
              nights={nights}
              weekend={weekend}
              today={today}
              rowBase={base}
              expanded={open}
              fit={fits ? (fits.get(p.id) ?? null) : undefined}
              selection={selection?.propertyId === p.id ? selection : null}
              handlers={handlers}
            />
          );
        })}
      </div>
    </div>
  );
}
