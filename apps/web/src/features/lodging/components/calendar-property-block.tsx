import { ChevronRight, StickyNote, Tag } from 'lucide-react';
import { memo, type MouseEvent, type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { CalendarSelection, CellRef, SelectModifiers } from '../hooks/use-calendar-selection';
import type {
  AvailabilityOptionData,
  CalendarPropertyData,
  CalendarRowData,
} from '../lib/calendar-model';
import { segmentSpans, takenByNight } from '../lib/calendar-model';
import { clockTime, dayMonth, formatShortVnd, formatVnd, weekdayLong } from '../lib/format';
import type { NoteFocus } from './booking-night-notes';
import { STATUS_STYLE } from './booking-status-badge';
import { BookingQuickView, CellTip, InternalNoteCard, NightNoteTip } from './calendar-quick-view';

export interface CellHandlers {
  onCell: (cell: CellRef, mods: SelectModifiers) => void;
  onPointerDown: (cell: CellRef) => void;
  onPointerEnter: (cell: CellRef) => void;
  onOpenBooking: (bookingId: string) => void;
  /**
   * Opens the booking sheet on its "Ghi chú ngày" for that night and the cell's unit (a room, or
   * null for the property); absent without orders.manage.
   */
  onEditNightNote?: (bookingId: string, at: NoteFocus) => void;
  onToggle: (propertyId: string) => void;
  /** Absent for members who cannot create bookings: no "Giữ chỗ" pill. */
  onHold?: (option: AvailabilityOptionData) => void;
}

const HOLD_WARN_MS = 15 * 60_000;

/** Grid column of night index `i` (column 1 is the sticky property column). */
const col = (i: number) => ({ gridColumn: `${i + 2}`, gridRow: '1' });

const cellClass =
  'relative flex h-10 w-full items-center justify-center text-xs tabular-nums outline-none focus-visible:z-[3] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset';

function modifiers(e: MouseEvent): SelectModifiers {
  return { shift: e.shiftKey, multi: e.ctrlKey || e.metaKey };
}

/** Night note text of a row by night (undefined = no note). */
type NoteOf = (night: string) => string | undefined;

/** Small dot in the corner of a cell that has a night note (above the booking bar). */
function NoteDot() {
  return (
    <span
      aria-hidden
      data-note-dot=""
      className="pointer-events-none absolute top-0.5 right-0.5 z-[3] size-1.5 rounded-full bg-primary"
    />
  );
}

interface RowProps {
  label: string;
  rowIndex: number;
  nights: string[];
  weekend: boolean[];
  today: string;
  handlers: CellHandlers;
  selected: (night: string) => boolean;
  header: ReactNode;
  headerClassName?: string;
  noteOf: NoteOf;
}

/** One unit row: a free night is a button with its price, an occupied night opens its booking. */
function UnitRow({
  row,
  propertyId,
  room,
  ...p
}: RowProps & { row: CalendarRowData; propertyId: string; room: boolean }) {
  const { t } = useTranslation();
  const taken = takenByNight(row, p.nights);
  const prices = new Map(row.prices.map((n) => [n.night, n.sell]));
  const now = Date.now();
  return (
    <div role="row" className="relative grid grid-cols-(--cal-cols) border-b border-border">
      <div
        role="rowheader"
        style={{ gridColumn: '1', gridRow: '1' }}
        className={cn(
          'sticky left-0 z-[4] flex min-w-0 items-center bg-background',
          p.headerClassName,
        )}
      >
        {p.header}
      </div>
      {p.nights.map((night, i) => {
        const seg = taken[i];
        const ref: CellRef = { propertyId, unitId: row.unitId, night, room };
        const day = weekdayLong(t, night);
        const date = dayMonth(night);
        const sell = prices.get(night) ?? null;
        const note = p.noteOf(night);
        const withNote = (base: string) =>
          note ? t('lodging.cal.cellNote', { base, text: note }) : base;
        return (
          <div
            key={night}
            role="gridcell"
            style={col(i)}
            className={cn(
              'border-l border-border',
              p.weekend[i] && 'bg-muted/60',
              night === p.today && 'bg-primary-soft/50',
            )}
          >
            {seg ? (
              <CellTip
                content={
                  <BookingQuickView
                    segment={seg}
                    nightNote={note}
                    {...(p.handlers.onEditNightNote
                      ? {
                          onEditNote: () =>
                            p.handlers.onEditNightNote?.(seg.bookingId, {
                              night,
                              unitId: room ? row.unitId : null,
                            }),
                        }
                      : {})}
                  />
                }
              >
                <button
                  type="button"
                  tabIndex={-1}
                  data-r={p.rowIndex}
                  data-c={i}
                  className={cellClass}
                  aria-label={withNote(
                    t('lodging.cal.cellTaken', {
                      unit: p.label,
                      day,
                      date,
                      status: t(`lodging.bookingStatus.${seg.status}`),
                      code: seg.code,
                    }),
                  )}
                  onClick={() => p.handlers.onOpenBooking(seg.bookingId)}
                >
                  {note && <NoteDot />}
                </button>
              </CellTip>
            ) : (
              <CellTip content={note && <NightNoteTip text={note} />}>
                <button
                  type="button"
                  tabIndex={-1}
                  data-r={p.rowIndex}
                  data-c={i}
                  className={cn(
                    cellClass,
                    'text-muted-foreground hover:text-foreground hover:ring-1 hover:ring-primary/60 hover:ring-inset',
                    p.selected(night) &&
                      'bg-primary/15 text-foreground ring-1 ring-primary ring-inset',
                  )}
                  aria-label={withNote(
                    sell === null
                      ? t('lodging.cal.cellNoPrice', { unit: p.label, day, date })
                      : t('lodging.cal.cellFree', {
                          unit: p.label,
                          day,
                          date,
                          price: formatVnd(sell),
                        }),
                  )}
                  onPointerDown={(e) => e.button === 0 && p.handlers.onPointerDown(ref)}
                  onPointerEnter={() => p.handlers.onPointerEnter(ref)}
                  onClick={(e) => p.handlers.onCell(ref, modifiers(e))}
                >
                  {sell === null ? '–' : formatShortVnd(sell)}
                  {note && <NoteDot />}
                </button>
              </CellTip>
            )}
          </div>
        );
      })}
      {segmentSpans(row, p.nights).map(({ segment: s, start, end }) => {
        const style = STATUS_STYLE[s.status];
        const Icon = style.icon;
        const expiresSoon =
          s.holdExpiresAt !== null && new Date(s.holdExpiresAt).getTime() - now < HOLD_WARN_MS;
        const label = s.kind === 'block' ? s.blockReason || s.code : `${s.guestName} · ${s.code}`;
        const urgent = expiresSoon && s.status === 'hold';
        return (
          <div
            key={s.bookingId}
            aria-hidden
            title={label}
            style={{ gridColumn: `${start + 2} / ${end + 2}`, gridRow: '1' }}
            className={cn(
              '@container pointer-events-none z-[2] mx-0.5 flex h-7 min-w-0 items-center gap-1 self-center overflow-hidden rounded-md border px-1.5 text-xs',
              style.className,
              // Short bars hide the status text, so the urgency stays on the border and icon.
              urgent && 'border-destructive',
            )}
          >
            <Icon className={cn('size-3 shrink-0', urgent && 'text-destructive')} />
            {/* The guest · code keeps ~6rem; the status text hides first. */}
            <span className="min-w-[min(6rem,100%)] shrink truncate font-medium">{label}</span>
            <span
              className={cn(
                'hidden min-w-0 shrink-[999] truncate @min-[10rem]:inline',
                urgent && 'font-semibold text-destructive',
              )}
            >
              {t(`lodging.bookingStatus.${s.status}`)}
              {s.status === 'hold' && s.holdExpiresAt
                ? ` · ${t('lodging.cal.holdExpires', { time: clockTime(s.holdExpiresAt) })}`
                : ''}
            </span>
            {s.note && <StickyNote data-marker="note" className="size-3 shrink-0" />}
            {s.tags.length > 0 && (
              <span
                data-marker="tags"
                className="inline-flex shrink-0 items-center gap-0.5 text-[11px] tabular-nums"
              >
                <Tag className="size-3" />
                {s.tags.length}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Property row of a `rooms` property: whole-place price when every room is free, else "free/total". */
function RoomsSummaryRow({ property, ...p }: RowProps & { property: CalendarPropertyData }) {
  const { t } = useTranslation();
  const takenRows = property.rows.map((row) => takenByNight(row, p.nights));
  const prices = new Map(property.wholePrices.map((n) => [n.night, n.sell]));
  const total = property.rows.length;
  return (
    <div role="row" className="relative grid grid-cols-(--cal-cols) border-b border-border">
      <div
        role="rowheader"
        style={{ gridColumn: '1', gridRow: '1' }}
        className={cn(
          'sticky left-0 z-[4] flex min-w-0 items-center bg-background',
          p.headerClassName,
        )}
      >
        {p.header}
      </div>
      {p.nights.map((night, i) => {
        const free = takenRows.filter((r) => r[i] === null).length;
        const day = weekdayLong(t, night);
        const date = dayMonth(night);
        const sell = prices.get(night) ?? null;
        const ref: CellRef = { propertyId: property.id, unitId: null, night, room: false };
        const allFree = free === total && total > 0;
        const note = p.noteOf(night);
        const withNote = (base: string) =>
          note ? t('lodging.cal.cellNote', { base, text: note }) : base;
        return (
          <div
            key={night}
            role="gridcell"
            style={col(i)}
            className={cn(
              'border-l border-border',
              p.weekend[i] && 'bg-muted/60',
              night === p.today && 'bg-primary-soft/50',
            )}
          >
            <CellTip content={note && <NightNoteTip text={note} />}>
              {allFree ? (
                <button
                  type="button"
                  tabIndex={-1}
                  data-r={p.rowIndex}
                  data-c={i}
                  className={cn(
                    cellClass,
                    'text-muted-foreground hover:text-foreground hover:ring-1 hover:ring-primary/60 hover:ring-inset',
                    p.selected(night) &&
                      'bg-primary/15 text-foreground ring-1 ring-primary ring-inset',
                  )}
                  aria-label={withNote(
                    sell === null
                      ? t('lodging.cal.cellNoPrice', { unit: p.label, day, date })
                      : t('lodging.cal.cellFree', {
                          unit: p.label,
                          day,
                          date,
                          price: formatVnd(sell),
                        }),
                  )}
                  onPointerDown={(e) => e.button === 0 && p.handlers.onPointerDown(ref)}
                  onPointerEnter={() => p.handlers.onPointerEnter(ref)}
                  onClick={(e) => p.handlers.onCell(ref, modifiers(e))}
                >
                  {sell === null ? '–' : formatShortVnd(sell)}
                  {note && <NoteDot />}
                </button>
              ) : (
                <button
                  type="button"
                  tabIndex={-1}
                  data-r={p.rowIndex}
                  data-c={i}
                  className={cn(
                    cellClass,
                    free === 0
                      ? 'bg-hatch-muted text-muted-foreground'
                      : 'bg-primary-soft text-primary-strong',
                  )}
                  aria-label={withNote(
                    t('lodging.cal.cellPartial', { unit: p.label, day, date, free, total }),
                  )}
                  onClick={() => p.handlers.onToggle(property.id)}
                >
                  {free}/{total}
                  {note && <NoteDot />}
                </button>
              )}
            </CellTip>
          </div>
        );
      })}
    </div>
  );
}

export interface PropertyBlockProps {
  property: CalendarPropertyData;
  nights: string[];
  weekend: boolean[];
  today: string;
  rowBase: number;
  expanded: boolean;
  /** Search result for this property; undefined = no search running. */
  fit: AvailabilityOptionData | null | undefined;
  /** The selection when it is on this property. */
  selection: CalendarSelection | null;
  handlers: CellHandlers;
}

/** A property's rows: its own row and, when expanded, one row per room. Memoised per property. */
export const PropertyBlock = memo(function PropertyBlock({
  property,
  nights,
  weekend,
  today,
  rowBase,
  expanded,
  fit,
  selection,
  handlers,
}: PropertyBlockProps) {
  const { t } = useTranslation();
  const searching = fit !== undefined;
  const fits = Boolean(fit?.fits);
  const inRange = (night: string) =>
    Boolean(selection && night >= selection.start && night <= selection.end);
  const rooms = property.sellMode === 'rooms';
  const notes = useMemo(
    () => new Map(property.notes.map((n) => [`${n.unitId ?? ''}|${n.night}`, n.text])),
    [property.notes],
  );
  const noteFor =
    (unitId: string | null): NoteOf =>
    (night) =>
      notes.get(`${unitId ?? ''}|${night}`);
  const capacity = t('lodging.cal.capacity', {
    adults: property.standardAdults,
    children: property.standardChildren,
  });
  const title = (
    <div className="min-w-0 flex-1 px-2 py-1">
      <div className="flex items-baseline gap-1.5">
        <span className="text-sm font-semibold">{property.code}</span>
        <span className="truncate text-xs text-muted-foreground">{property.name}</span>
      </div>
      <div className="text-xs tabular-nums text-muted-foreground">
        {capacity}
        {rooms && ` · ${t('lodging.cal.rooms', { count: property.rows.length })}`}
      </div>
    </div>
  );
  const name = rooms ? (
    <button
      type="button"
      className="flex w-full min-w-0 items-center text-left hover:bg-muted/60"
      aria-expanded={expanded}
      aria-label={t('lodging.cal.expand', { code: property.code })}
      onClick={() => handlers.onToggle(property.id)}
    >
      <ChevronRight
        aria-hidden
        className={cn('ml-1 size-4 shrink-0 transition-transform', expanded && 'rotate-90')}
      />
      {title}
    </button>
  ) : (
    title
  );
  const header = (
    <div className="flex w-full min-w-0 flex-col">
      {property.internalNote ? (
        <InternalNoteCard code={property.code} note={property.internalNote}>
          {name}
        </InternalNoteCard>
      ) : (
        name
      )}
      {fits && fit && handlers.onHold && (
        <Button
          size="xs"
          className="mx-2 mb-1 w-fit tabular-nums"
          onClick={() => handlers.onHold?.(fit)}
        >
          {fit.quote.totalSell === null
            ? t('lodging.find.holdNoPrice')
            : t('lodging.find.hold', { amount: formatVnd(fit.quote.totalSell) })}
        </Button>
      )}
    </div>
  );
  const headerClassName = cn(fits && 'border-l-2 border-primary');
  const common = {
    nights,
    weekend,
    today,
    handlers,
    header,
    headerClassName,
    noteOf: noteFor(null),
  };
  const wholeRow = property.rows[0];
  return (
    <div
      role="rowgroup"
      data-property={property.id}
      data-fit={fits ? 'true' : undefined}
      className={cn(searching && !fits && 'opacity-50', fits && 'bg-primary-soft/40')}
    >
      {rooms ? (
        <RoomsSummaryRow
          {...common}
          property={property}
          label={property.code}
          rowIndex={rowBase}
          selected={(n) => Boolean(selection?.whole) && inRange(n)}
        />
      ) : (
        wholeRow && (
          <UnitRow
            {...common}
            row={wholeRow}
            propertyId={property.id}
            room={false}
            label={property.code}
            rowIndex={rowBase}
            selected={inRange}
          />
        )
      )}
      {rooms &&
        expanded &&
        property.rows.map((row, i) => (
          <UnitRow
            key={row.unitId}
            {...common}
            header={<span className="truncate py-2 pr-2 pl-9 text-sm">{row.name}</span>}
            headerClassName=""
            noteOf={noteFor(row.unitId)}
            row={row}
            propertyId={property.id}
            room
            label={`${property.code} ${row.name}`}
            rowIndex={rowBase + 1 + i}
            selected={(n) =>
              Boolean(selection && !selection.whole && selection.unitIds.includes(row.unitId)) &&
              inRange(n)
            }
          />
        ))}
    </div>
  );
});

/** Interactive rows a property takes in the grid (for roving focus indexes). */
export function rowsOf(property: CalendarPropertyData, expanded: boolean): number {
  return property.sellMode === 'rooms' && expanded ? 1 + property.rows.length : 1;
}
