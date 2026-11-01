import type { AvailabilityRequest } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { CircleAlert, House } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
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
import { addDays, dayMonth, nightList, todayNight } from '../lib/format';
import { BookingSheet } from './booking-sheet';
import { CalendarGrid } from './calendar-grid';
import { CalendarMobile } from './calendar-mobile';
import type { CellHandlers } from './calendar-property-block';
import { CalendarToolbar, type RangeNights } from './calendar-toolbar';
import { FindAvailabilityBar } from './find-availability-bar';

type SheetState =
  | { mode: 'create'; initial: BookingCreateInitial; key: number }
  | { mode: 'view'; bookingId: string; key: number }
  | null;

/**
 * Lịch (spec §5.1): the sales home page. Answers "ngày X–Y, N người, còn căn nào, bao
 * nhiêu tiền?" with the find bar, and places a hold from the grid in about three clicks.
 */
export function CalendarPage({ initialFrom }: { initialFrom?: string }) {
  const { t } = useTranslation();
  const mobile = useIsMobile();
  const [start, setStart] = useState<string | null>(initialFrom ?? null);
  const [rangeNights, setRangeNights] = useState<RangeNights>(14);
  const [area, setArea] = useState('');
  const [onlyFree, setOnlyFree] = useState(false);
  const [search, setSearch] = useState<AvailabilityRequest | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [sheet, setSheet] = useState<SheetState>(null);
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
      onToggle: (id) =>
        setExpanded((prev) => {
          const next = new Set(prev);
          if (!next.delete(id)) next.add(id);
          return next;
        }),
      ...(canManage
        ? {
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
    [canManage, select, pointerDown, pointerEnter, openCreate, search],
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
      ? t('lodging.find.error')
      : availability.isFetching
        ? t('lodging.loading')
        : fitCount
          ? t('lodging.find.result', { count: fitCount })
          : t('lodging.find.none');

  const runSearch = (body: AvailabilityRequest) => {
    setSearch(body);
    if (body.checkIn < from || body.checkIn >= to) setStart(body.checkIn);
  };
  const shift = (direction: -1 | 0 | 1) =>
    setStart(direction === 0 ? null : addDays(from, direction * nightsCount));

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h1 className="text-xl font-semibold">{t('lodging.calendarTitle')}</h1>
      <FindAvailabilityBar
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
          {t('lodging.cal.selecting', { date: dayMonth(selection.start) })}
        </p>
      )}

      {calendar.isPending ? (
        <div className="grid gap-1.5" role="status" aria-label={t('lodging.loading')}>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : calendar.isError ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription className="flex flex-wrap items-center gap-2">
            {t('lodging.loadError')}
            <Button size="xs" variant="outline" onClick={() => void calendar.refetch()}>
              {t('lodging.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : all.length === 0 ? (
        <div className="grid justify-items-center gap-2 rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <p className="font-medium">{t('lodging.cal.empty')}</p>
          <p className="text-sm text-muted-foreground">{t('lodging.cal.emptyHint')}</p>
          <Button asChild size="sm">
            <Link to="/app/properties">
              <House aria-hidden />
              {t('lodging.cal.addProperty')}
            </Link>
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <p className="rounded-lg border border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {t('lodging.cal.noRows')}
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
          onOpenChange={(open) => !open && setSheet(null)}
        />
      )}
    </div>
  );
}
