import type { AvailabilityRequest } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { CircleAlert, House } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsMobile } from '@/hooks/use-mobile';
import { useCan } from '@/lib/permissions';

import { useAvailability, useLodgingCalendar } from '../api/calendar';
import type { BookingCreateInitial } from '../hooks/use-booking-draft';
import { type CalendarSelection, useCalendarSelection } from '../hooks/use-calendar-selection';
import { type AvailabilityOptionData, bestOptions, hasFreeNight } from '../lib/calendar-model';
import {
  type CalendarSearch,
  compactCalendarSearch,
  expandedOf,
  findOf,
  findParams,
  openOf,
  rememberCalendarSearch,
} from '../lib/calendar-search';
import { addDays, dayMonth, nightList, todayNight } from '../lib/format';
import type { NoteFocus } from './booking-night-notes';
import { BookingSheet } from './booking-sheet';
import { CalendarGrid } from './calendar-grid';
import { CalendarMobile } from './calendar-mobile';
import type { CellHandlers } from './calendar-property-block';
import { CalendarToolbar, type RangeNights } from './calendar-toolbar';
import { FindAvailabilityBar } from './find-availability-bar';

type SheetState =
  | { mode: 'create'; initial: BookingCreateInitial; key: number }
  | { mode: 'view'; bookingId: string; noteAt?: NoteFocus; key: number }
  | null;

/**
 * Lịch (spec §5.1): the sales home page. Answers "ngày X–Y, N người, còn căn nào, bao
 * nhiêu tiền?" with the find bar, and places a hold from the grid in about three clicks.
 */
export function CalendarPage({
  search: url,
  onSearch,
}: {
  /** The route's search: window, filters, expanded rows and the find search. */
  search: CalendarSearch;
  /** Replaces the search (the route rewrites the current history entry). */
  onSearch: (next: CalendarSearch) => void;
}) {
  const { t } = useTranslation('lodging');
  const mobile = useIsMobile();
  const start = url.from ?? null;
  const rangeNights: RangeNights = url.nights ?? 14;
  const area = url.area ?? '';
  const onlyFree = url.free ?? false;
  const search = useMemo(() => findOf(url), [url]);
  const expanded = useMemo(() => expandedOf(url), [url]);
  const [sheet, setSheet] = useState<SheetState>(null);
  // Kept for the "← Lịch" link of a property's calendar.
  useEffect(() => rememberCalendarSearch(url), [url]);
  const latest = useRef(url);
  latest.current = url;
  const go = useCallback(
    (patch: CalendarSearch) => onSearch(compactCalendarSearch({ ...latest.current, ...patch })),
    [onSearch],
  );
  const setStart = (from: string | null) => go({ from: from ?? undefined });
  const setRangeNights = (n: RangeNights) => go({ nights: n === 31 ? 31 : undefined });
  const setArea = (a: string) => go({ area: a || undefined });
  const setOnlyFree = (v: boolean) => go({ free: v || undefined });
  const setSearch = (body: AvailabilityRequest | null) => go(findParams(body));
  // View-only members read the calendar and open bookings, but cannot select or hold.
  const canManage = useCan('orders.manage');

  const nightsCount = mobile ? 31 : rangeNights;
  const from = start ?? todayNight();
  const to = addDays(from, nightsCount);
  const nights = useMemo(() => nightList(from, to), [from, to]);
  const calendar = useLodgingCalendar({ from, to });
  const availability = useAvailability(search);
  const fits = useMemo(
    () => (search && availability.data ? bestOptions(availability.data.options) : null),
    [search, availability.data],
  );

  const openCreate = useCallback((initial: BookingCreateInitial) => {
    setSheet((s) => ({ mode: 'create', initial, key: (s?.key ?? 0) + 1 }));
  }, []);
  const onComplete = useCallback(
    (sel: CalendarSelection) =>
      openCreate({
        propertyId: sel.propertyId,
        checkIn: sel.start,
        checkOut: addDays(sel.end, 1),
        whole: sel.whole,
        unitIds: sel.unitIds,
        nightNotes: calendar.data?.properties.find((p) => p.id === sel.propertyId)?.notes ?? [],
        ...(search ? { party: search.party } : {}),
      }),
    [openCreate, search, calendar.data],
  );
  const { selection, select, pointerDown, pointerEnter, clear } = useCalendarSelection(onComplete);

  const handlers = useMemo<CellHandlers>(
    () => ({
      onCell: canManage ? select : () => {},
      onPointerDown: canManage ? pointerDown : () => {},
      onPointerEnter: canManage ? pointerEnter : () => {},
      onOpenBooking: (bookingId) =>
        setSheet((s) => ({ mode: 'view', bookingId, key: (s?.key ?? 0) + 1 })),
      onToggle: (id) => {
        const next = new Set(expandedOf(latest.current));
        if (!next.delete(id)) next.add(id);
        go({ open: openOf(next) });
      },
      ...(canManage
        ? {
            onEditNightNote: (bookingId: string, noteAt: NoteFocus) =>
              setSheet((s) => ({
                mode: 'view',
                bookingId,
                noteAt,
                key: (s?.key ?? 0) + 1,
              })),
            onHold: (o: AvailabilityOptionData) =>
              search &&
              openCreate({
                propertyId: o.propertyId,
                checkIn: search.checkIn,
                checkOut: search.checkOut,
                whole: o.whole,
                unitIds: o.whole ? [] : o.unitIds,
                party: { adults: search.party.adults, childAges: search.party.childAges ?? [] },
              }),
          }
        : {}),
    }),
    [canManage, select, pointerDown, pointerEnter, openCreate, search, go],
  );

  const all = useMemo(() => calendar.data?.properties ?? [], [calendar.data]);
  const areas = useMemo(() => [...new Set(all.map((p) => p.area).filter(Boolean))].sort(), [all]);
  const visible = useMemo(
    () =>
      all.filter((p) => {
        if (area && p.area !== area) return false;
        if (!onlyFree) return true;
        return fits ? Boolean(fits.get(p.id)?.fits) : hasFreeNight(p, nights);
      }),
    [all, area, onlyFree, fits, nights],
  );

  const fitCount = fits ? [...fits.values()].filter((o) => o.fits).length : 0;
  const findStatus = !search
    ? null
    : availability.isError
      ? t('find.error')
      : availability.isFetching
        ? t('loading')
        : fitCount
          ? t('find.result', { count: fitCount })
          : t('find.none');

  const runSearch = (body: AvailabilityRequest) =>
    go({
      ...findParams(body),
      ...(body.checkIn < from || body.checkIn >= to ? { from: body.checkIn } : {}),
    });
  const shift = (direction: -1 | 0 | 1) =>
    setStart(direction === 0 ? null : addDays(from, direction * nightsCount));

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h1 className="text-xl font-semibold">{t('calendarTitle')}</h1>
      <FindAvailabilityBar
        initial={search}
        active={search !== null}
        status={findStatus}
        onSearch={runSearch}
        onClear={() => setSearch(null)}
      />
      <CalendarToolbar
        from={from}
        nights={rangeNights}
        shownNights={nightsCount}
        showRange={!mobile}
        onShift={shift}
        onNights={setRangeNights}
        areas={areas}
        area={area}
        onArea={setArea}
        onlyFree={onlyFree}
        onOnlyFree={setOnlyFree}
      />
      {selection && !selection.complete && (
        <p role="status" className="text-xs text-muted-foreground">
          {t('cal.selecting', { date: dayMonth(selection.start) })}
        </p>
      )}

      {calendar.isPending ? (
        <div className="grid gap-1.5" role="status" aria-label={t('loading')}>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
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
      ) : all.length === 0 ? (
        <div className="grid justify-items-center gap-2 rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <p className="font-medium">{t('cal.empty')}</p>
          <p className="text-sm text-muted-foreground">{t('cal.emptyHint')}</p>
          <Button asChild size="sm">
            <Link to="/app/properties">
              <House aria-hidden />
              {t('cal.addProperty')}
            </Link>
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <p className="rounded-lg border border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {t('cal.noRows')}
        </p>
      ) : mobile ? (
        <CalendarMobile
          properties={visible}
          nights={nights}
          today={calendar.data.today}
          {...(canManage
            ? {
                onCreate: (propertyId: string, night?: string) =>
                  openCreate(
                    night
                      ? { propertyId, checkIn: night, checkOut: addDays(night, 1) }
                      : { propertyId },
                  ),
              }
            : {})}
          onOpenBooking={handlers.onOpenBooking}
        />
      ) : (
        <CalendarGrid
          properties={visible}
          nights={nights}
          today={calendar.data.today}
          expanded={expanded}
          fits={fits}
          selection={selection}
          handlers={handlers}
        />
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
