import { Link } from '@tanstack/react-router';
import { CircleAlert } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/lib/permissions';

import { useBookings } from '../../api/bookings';
import { useLodgingCalendar } from '../../api/calendar';
import type { BookingCreateInitial } from '../../hooks/use-booking-draft';
import { type CalendarSelection, useCalendarSelection } from '../../hooks/use-calendar-selection';
import { botHoldPending } from '../../lib/bot-hold';
import { addDays, dayMonth, nightList, todayNight } from '../../lib/format';
import {
  addMonths,
  compactSearch,
  dayInfos,
  monthOccupancy,
  monthsFrom,
  monthStart,
  monthWeeks,
  type PropertyCalendarSearch,
  type PropertyCalendarView,
  rangeStats,
  rowsInScope,
  VIEW_STEP_MONTHS,
  viewWindow,
  visibleNights,
} from '../../lib/property-calendar-model';
import type { NoteFocus } from '../booking-night-notes';
import { BookingSheet } from '../booking-sheet';
import { QuarterMonth, StateLegend, YearMonth } from './compact-months';
import { PropertyBookingsList } from './property-bookings-list';
import { PropertyCalendarHeader, UnitChips } from './property-calendar-header';
import { panelBookings, PropertyCalendarStats } from './property-calendar-stats';
import { type MonthHandlers, PropertyMonthView } from './property-month-view';

type SheetState =
  | { mode: 'create'; initial: BookingCreateInitial; key: number }
  | { mode: 'view'; bookingId: string; noteAt?: NoteFocus; key: number }
  | null;

const noop = () => {};

/**
 * "Lịch căn" (`/app/calendar/$propertyId`): the calendar of one property as a month, three
 * months, a year or a booking list, with a side panel for the shown range. The route owns the
 * search (`view`, `from`, `unit`); this page reads it and asks for changes through `onSearch`.
 */
export function PropertyCalendarPage({
  propertyId,
  search,
  onSearch,
}: {
  propertyId: string;
  search: PropertyCalendarSearch;
  onSearch: (next: PropertyCalendarSearch) => void;
}) {
  const { t } = useTranslation('lodging');
  const canManage = useCan('orders.manage');
  const view: PropertyCalendarView = search.view ?? 'month';
  const month = monthStart(search.from ?? todayNight());
  const win = viewWindow(view, month);
  const ids = useMemo(() => [propertyId], [propertyId]);
  const calendar = useLodgingCalendar({ from: win.from, to: win.to, propertyIds: ids });
  const upcoming = useBookings({ view: 'upcoming', propertyId });
  const [sheet, setSheet] = useState<SheetState>(null);

  const property = calendar.data?.properties.find((p) => p.id === propertyId);
  const today = calendar.data?.today ?? todayNight();
  const room =
    property?.sellMode === 'rooms' && search.unit
      ? property.rows.find((r) => r.unitId === search.unit)
      : undefined;
  const summary = property?.sellMode === 'rooms' && !room;
  const rows = useMemo(
    () => (property ? rowsInScope(property, room?.unitId) : []),
    [property, room],
  );
  const shown = useMemo(() => visibleNights(view, month), [view, month]);
  const windowNights = useMemo(() => nightList(win.from, win.to), [win.from, win.to]);
  const days = useMemo(
    () => (property ? dayInfos(property, rows, summary, windowNights) : new Map()),
    [property, rows, summary, windowNights],
  );
  const notes = useMemo(
    () => new Map((property?.notes ?? []).map((n) => [`${n.unitId ?? ''}|${n.night}`, n.text])),
    [property],
  );
  const noteOf = useCallback(
    (night: string) => notes.get(`${room?.unitId ?? ''}|${night}`),
    [notes, room],
  );

  const go = (patch: PropertyCalendarSearch) =>
    onSearch(compactSearch({ view, from: search.from, unit: search.unit, ...patch }));
  const openMonth = (m: string) => go({ view: 'month', from: m });
  const openBooking = useCallback(
    (bookingId: string) => setSheet((s) => ({ mode: 'view', bookingId, key: (s?.key ?? 0) + 1 })),
    [],
  );
  const onComplete = useCallback(
    (sel: CalendarSelection) =>
      setSheet((s) => ({
        mode: 'create',
        initial: {
          propertyId: sel.propertyId,
          checkIn: sel.start,
          checkOut: addDays(sel.end, 1),
          whole: sel.whole,
          unitIds: sel.unitIds,
          nightNotes: property?.notes ?? [],
        },
        key: (s?.key ?? 0) + 1,
      })),
    [property],
  );
  const { selection, select, pointerDown, pointerEnter, clear } = useCalendarSelection(onComplete);
  const handlers = useMemo<MonthHandlers>(
    () => ({
      // View-only members read the calendar and open bookings, but cannot select or hold.
      onCell: canManage ? select : noop,
      onPointerDown: canManage ? pointerDown : noop,
      onPointerEnter: canManage ? pointerEnter : noop,
      onOpenBooking: openBooking,
      ...(canManage
        ? {
            onEditNightNote: (bookingId: string, noteAt: NoteFocus) =>
              setSheet((s) => ({ mode: 'view', bookingId, noteAt, key: (s?.key ?? 0) + 1 })),
          }
        : {}),
    }),
    [canManage, select, pointerDown, pointerEnter, openBooking],
  );

  const stats = useMemo(() => rangeStats(rows, shown), [rows, shown]);
  const panel = useMemo(() => {
    const list = (upcoming.data?.data ?? []).filter(
      (b) => !room || b.whole || b.unitIds.includes(room.unitId),
    );
    const end = addDays(shown[shown.length - 1] ?? month, 1);
    return {
      ...panelBookings(list, { from: shown[0] ?? month, to: end, today }),
      botHolds: list.filter(botHoldPending),
    };
  }, [upcoming.data, room, shown, month, today]);

  const months = useMemo(() => monthsFrom(month, view === 'quarter' ? 3 : 12), [view, month]);
  const monthPcts = useMemo(
    () => (view === 'quarter' || view === 'year' ? monthOccupancy(rows, months) : []),
    [rows, view, months],
  );

  const body = !property ? null : view === 'list' ? (
    <PropertyBookingsList
      propertyId={propertyId}
      roomId={room?.unitId ?? null}
      today={today}
      onOpen={openBooking}
    />
  ) : view === 'month' ? (
    <PropertyMonthView
      propertyId={propertyId}
      month={month}
      weeks={monthWeeks(month)}
      days={days}
      row={summary ? undefined : rows[0]}
      roomId={room?.unitId ?? null}
      summary={summary}
      today={today}
      selection={selection}
      noteOf={noteOf}
      handlers={handlers}
    />
  ) : (
    <div className="grid gap-3">
      <StateLegend summary={summary} />
      <div
        className={
          view === 'quarter'
            ? 'grid gap-3 md:grid-cols-3'
            : 'grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 sm:gap-3'
        }
        data-testid={`pcal-${view}`}
      >
        {months.map((m, i) =>
          view === 'quarter' ? (
            <QuarterMonth
              key={m}
              month={m}
              days={days}
              summary={summary}
              today={today}
              pct={monthPcts[i] ?? 0}
              onOpenMonth={openMonth}
              onOpenBooking={openBooking}
            />
          ) : (
            <YearMonth
              key={m}
              month={m}
              days={days}
              summary={summary}
              today={today}
              pct={monthPcts[i] ?? 0}
              onOpenMonth={openMonth}
            />
          ),
        )}
      </div>
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <PropertyCalendarHeader
        property={property}
        view={view}
        month={month}
        onStep={(d) =>
          go({ from: d === 0 ? undefined : addMonths(month, d * VIEW_STEP_MONTHS[view]) })
        }
        onView={(v) => go({ view: v })}
      />
      {property?.sellMode === 'rooms' && (
        <UnitChips property={property} unitId={room?.unitId} onUnit={(unit) => go({ unit })} />
      )}
      {selection && !selection.complete && (
        <p role="status" className="text-xs text-muted-foreground">
          {t('cal.selecting', { date: dayMonth(selection.start) })}
        </p>
      )}

      {calendar.isPending ? (
        <div className="grid gap-1.5" role="status" aria-label={t('loading')}>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : calendar.isError ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription className="flex flex-wrap items-center gap-2">
            {t('loadError')}
            <Button size="xs" variant="outline" onClick={() => void calendar.refetch()}>
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : !property ? (
        <div className="grid justify-items-center gap-2 rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <p className="font-medium">{t('pcal.notFound')}</p>
          <Button asChild size="sm" variant="outline">
            <Link to="/app/calendar">{t('pcal.backLabel')}</Link>
          </Button>
        </div>
      ) : view === 'list' ? (
        body
      ) : (
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0">{body}</div>
          <PropertyCalendarStats
            stats={stats}
            checkIns={panel.checkIns}
            checkOuts={panel.checkOuts}
            botHolds={panel.botHolds}
            dimmed={calendar.isPlaceholderData}
            onOpenBooking={openBooking}
          />
        </div>
      )}

      {sheet?.mode === 'create' && canManage && (
        <BookingSheet
          key={sheet.key}
          mode="create"
          open
          initial={sheet.initial}
          onOpenChange={(open) => {
            if (!open) {
              setSheet(null);
              clear();
            }
          }}
        />
      )}
      {sheet?.mode === 'view' && (
        <BookingSheet
          key={sheet.key}
          mode="view"
          open
          bookingId={sheet.bookingId}
          {...(sheet.noteAt ? { noteAt: sheet.noteAt } : {})}
          onOpenChange={(open) => !open && setSheet(null)}
        />
      )}
    </div>
  );
}
