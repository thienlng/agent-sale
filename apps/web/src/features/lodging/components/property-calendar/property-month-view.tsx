import { type KeyboardEvent, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

import {
  type CalendarSelection,
  type CellRef,
  modifiers,
  type SelectModifiers,
} from '../../hooks/use-calendar-selection';
import { type CalendarRowData, segmentSpans } from '../../lib/calendar-model';
import {
  addDays,
  dayMonth,
  formatShortVnd,
  formatVnd,
  isoWeekday,
  weekdayLong,
} from '../../lib/format';
import type { DayInfo } from '../../lib/property-calendar-model';
import type { NoteFocus } from '../booking-night-notes';
import { BookingBar, NoteDot } from '../calendar-booking-bar';
import { BookingQuickView, CellTip, NightNoteTip } from '../calendar-quick-view';

/** What the month cells do; selection handlers are no-ops for view-only members. */
export interface MonthHandlers {
  onCell: (cell: CellRef, mods: SelectModifiers) => void;
  onPointerDown: (cell: CellRef) => void;
  onPointerEnter: (cell: CellRef) => void;
  onOpenBooking: (bookingId: string) => void;
  /** Opens the booking sheet on "Ghi chú ngày"; absent without orders.manage. */
  onEditNightNote?: (bookingId: string, at: NoteFocus) => void;
}

const cellBase =
  'relative flex h-16 w-full flex-col items-start gap-0.5 p-1 text-left text-xs tabular-nums outline-none focus-visible:z-[3] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:h-24 sm:p-1.5';

/**
 * Tháng: a wall-calendar month, Monday first, with the adjacent months' days greyed. Each day
 * shows its number, price, date-range label and a dot for a night note; bookings are bars over
 * the nights they take, split per week. "Cả căn" of a rooms property shows "x/y trống" instead
 * of bars. Free nights select like the Lịch grid (click, drag, shift-click).
 */
export function PropertyMonthView({
  propertyId,
  month,
  weeks,
  days,
  row,
  roomId,
  summary,
  today,
  selection,
  noteOf,
  handlers,
}: {
  propertyId: string;
  /** First night of the shown month. */
  month: string;
  weeks: string[][];
  days: Map<string, DayInfo>;
  /** The single row whose bars are drawn; undefined on a summary. */
  row: CalendarRowData | undefined;
  /** The room in scope of a rooms property (null = the whole place). */
  roomId: string | null;
  summary: boolean;
  today: string;
  selection: CalendarSelection | null;
  noteOf: (night: string) => string | undefined;
  handlers: MonthHandlers;
}) {
  const { t } = useTranslation('lodging');
  const now = Date.now();
  const inMonth = (night: string) => night.slice(0, 7) === month.slice(0, 7);
  // Only a selection of the target on screen (this room, or the whole place) is drawn.
  const ownSelection =
    selection &&
    selection.propertyId === propertyId &&
    (roomId === null ? selection.whole : selection.unitIds.includes(roomId))
      ? selection
      : null;
  const selected = (night: string) =>
    Boolean(ownSelection && night >= ownSelection.start && night <= ownSelection.end);
  // Arrow keys move between days (a week up or down); days without a button are skipped over.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    const from = (e.target as HTMLElement).closest<HTMLElement>('[data-night]')?.dataset['night'];
    if (!step || !from) return;
    const first = weeks[0]?.[0] ?? from;
    const last = weeks[weeks.length - 1]?.[6] ?? from;
    for (let n = addDays(from, step); n >= first && n <= last; n = addDays(n, step)) {
      const target = e.currentTarget.querySelector<HTMLElement>(`[data-night="${n}"] button`);
      if (target) {
        e.preventDefault();
        target.focus();
        return;
      }
    }
  };
  const spans = useMemo(
    () => weeks.map((week) => (row ? segmentSpans(row, week) : [])),
    [weeks, row],
  );

  const freeCell = (night: string, day: DayInfo | undefined, label: string, note?: string) => {
    const ref: CellRef = {
      propertyId,
      unitId: roomId ?? (summary ? null : (row?.unitId ?? null)),
      night,
      room: roomId !== null,
    };
    const sell = day?.sell ?? null;
    const base =
      sell === null
        ? t('pcal.dayNoPrice', { date: label })
        : t('pcal.dayFree', { date: label, price: formatVnd(sell) });
    return (
      <CellTip content={note && <NightNoteTip text={note} />}>
        <button
          type="button"
          className={cn(
            cellBase,
            'hover:ring-1 hover:ring-primary/60 hover:ring-inset',
            selected(night) && 'bg-primary/15 ring-1 ring-primary ring-inset',
          )}
          aria-label={note ? t('cal.cellNote', { base, text: note }) : base}
          aria-pressed={selected(night)}
          onPointerDown={(e) => e.button === 0 && handlers.onPointerDown(ref)}
          onPointerEnter={() => handlers.onPointerEnter(ref)}
          onClick={(e) => handlers.onCell(ref, modifiers(e))}
        >
          <DayHead night={night} today={today} label={day?.label ?? ''} />
          <span className="mt-auto text-muted-foreground">
            {sell === null ? '–' : formatShortVnd(sell)}
          </span>
          {summary && day && (
            // Every room is free: phones keep the price only.
            <span className="hidden text-primary-strong sm:block">
              <FreeOf free={day.free} total={day.total} />
            </span>
          )}
          {note && <NoteDot />}
        </button>
      </CellTip>
    );
  };

  return (
    <div
      role="grid"
      aria-label={t('cal.gridLabel')}
      className="overflow-hidden rounded-lg border border-border select-none"
      data-testid="pcal-month"
      onKeyDown={onKeyDown}
    >
      <div role="row" className="grid grid-cols-7 border-b border-border bg-muted/40">
        {Array.from({ length: 7 }, (_, i) => (
          <div
            key={i}
            role="columnheader"
            className="py-1.5 text-center text-xs font-medium text-muted-foreground"
          >
            {t(`weekdayShort.${i + 1}`)}
          </div>
        ))}
      </div>
      {weeks.map((week, w) => (
        <div
          key={week[0]}
          role="row"
          className="relative grid grid-cols-7 border-b border-border last:border-b-0"
        >
          {week.map((night, i) => {
            const day = days.get(night);
            const seg = day?.segment ?? null;
            const note = noteOf(night);
            const label = `${weekdayLong(t, night)} ${dayMonth(night)}`;
            const partial = summary && day && day.free < day.total;
            return (
              <div
                key={night}
                role="gridcell"
                style={{ gridColumn: `${i + 1}`, gridRow: '1' }}
                className={cn(
                  'min-w-0 border-l border-border first:border-l-0',
                  isoWeekday(night) >= 6 && 'bg-muted/60',
                  !inMonth(night) && 'bg-muted/30 text-muted-foreground/60',
                )}
                data-night={night}
              >
                {seg ? (
                  <CellTip
                    content={
                      <BookingQuickView
                        segment={seg}
                        nightNote={note}
                        {...(handlers.onEditNightNote
                          ? {
                              onEditNote: () =>
                                handlers.onEditNightNote?.(seg.bookingId, {
                                  night,
                                  unitId: roomId,
                                }),
                            }
                          : {})}
                      />
                    }
                  >
                    <button
                      type="button"
                      className={cellBase}
                      aria-label={(() => {
                        const base = t('pcal.dayTaken', {
                          date: label,
                          status: t(`bookingStatus.${seg.status}`),
                          code: seg.code,
                        });
                        return note ? t('cal.cellNote', { base, text: note }) : base;
                      })()}
                      onClick={() => handlers.onOpenBooking(seg.bookingId)}
                    >
                      <DayHead night={night} today={today} label={day?.label ?? ''} />
                      {note && <NoteDot />}
                    </button>
                  </CellTip>
                ) : partial ? (
                  <div
                    className={cn(
                      cellBase,
                      day.free === 0
                        ? 'bg-hatch-muted text-muted-foreground'
                        : 'bg-half-primary text-primary-strong',
                    )}
                  >
                    <DayHead night={night} today={today} label={day.label} />
                    <span className="mt-auto font-medium">
                      <FreeOf free={day.free} total={day.total} />
                    </span>
                    <span className="sr-only">
                      {t('pcal.dayPartial', { date: label, free: day.free, total: day.total })}
                      {note ? `, ${note}` : ''}
                    </span>
                    {note && <NoteDot />}
                  </div>
                ) : (
                  freeCell(night, day, label, note)
                )}
              </div>
            );
          })}
          {spans[w]?.map(({ segment, start, end }) => (
            <BookingBar
              key={segment.bookingId}
              segment={segment}
              now={now}
              style={{ gridColumn: `${start + 1} / ${end + 1}`, gridRow: '1' }}
              className="mb-1.5 self-end sm:mb-2"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Day number (ringed on today) and the date-range price label ("Tết"). */
function DayHead({ night, today, label }: { night: string; today: string; label: string }) {
  return (
    <span className="flex w-full min-w-0 items-center gap-1">
      <span
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full text-sm font-medium',
          night === today && 'ring-2 ring-primary text-primary-strong',
        )}
      >
        {Number(night.slice(8, 10))}
      </span>
      {label && (
        <span
          title={label}
          className="hidden min-w-0 truncate rounded-sm bg-warning-soft px-1 text-[10px] font-medium text-warning sm:inline"
        >
          {label}
        </span>
      )}
    </span>
  );
}

/** "2/3 trống"; phones keep the numbers only. */
function FreeOf({ free, total }: { free: number; total: number }) {
  const { t } = useTranslation('lodging');
  return (
    <span aria-hidden className="text-[11px] whitespace-nowrap">
      <span className="sm:hidden">
        {free}/{total}
      </span>
      <span className="hidden sm:inline">{t('pcal.freeOf', { free, total })}</span>
    </span>
  );
}
