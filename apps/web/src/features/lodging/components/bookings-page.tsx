import {
  type BookingDto,
  type BookingListQuery,
  BookingStatus as BookingStatusEnum,
  type BookingStatus,
  BookingSource as BookingSourceEnum,
  type BookingSource,
  normalizeBookingTag,
  normalizeBookingTags,
} from '@agent-sales/contracts';
import { ChevronLeft, ChevronRight, CircleAlert, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCan } from '@/lib/permissions';

import { useBookingReviewCount, useBookings } from '../api/bookings';
import { useProperties } from '../api/properties';
import { useDebouncedValue } from '../hooks/use-debounced-value';
import { BookingSheet } from './booking-sheet';
import { BookingsTable } from './bookings-table';
import { HoldMinutesControl } from './hold-minutes-control';
import { useSuggestedTags } from './tag-input';

type View = BookingListQuery['view'];
const VIEWS: View[] = ['today', 'holds', 'upcoming', 'all'];
const ALL = 'all';
/** Tag filter "any tag" (not a valid tag value in practice). */
const ANY_TAG = '__any__';

/** Holds first by expiry (overdue first), so the list reads as a to-do. */
const byExpiry = (a: BookingDto, b: BookingDto) =>
  (a.holdExpiresAt ?? '9999').localeCompare(b.holdExpiresAt ?? '9999');

type SheetState = { key: number } & ({ mode: 'create' } | { mode: 'view'; bookingId: string });

/**
 * "Booking": Hôm nay (arrivals + departures) · Giữ chỗ (by expiry, overdue in red, with the
 * count of bot holds waiting for staff) · Sắp tới · Tất cả, with place / tag / source / status
 * filters, search and 100-row pages. Rows open the shared booking sheet.
 */
export function BookingsPage({ initialView = 'today' }: { initialView?: View }) {
  const { t } = useTranslation();
  const canManageCatalog = useCan('catalog.manage');
  const canManageOrders = useCan('orders.manage');
  const [view, setView] = useState<View>(initialView);
  const [propertyId, setPropertyId] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [tag, setTag] = useState(ANY_TAG);
  const [source, setSource] = useState(ALL);
  const suggested = useSuggestedTags();
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const search = useDebouncedValue(q.trim(), 300);
  const properties = useProperties();
  const query: Partial<BookingListQuery> = {
    view,
    ...(propertyId !== ALL ? { propertyId } : {}),
    ...(view === 'all' && status !== ALL ? { status: status as BookingStatus } : {}),
    ...(search ? { q: search } : {}),
    ...(tag !== ANY_TAG ? { tag } : {}),
    ...(source !== ALL ? { source: source as BookingSource } : {}),
    ...(offset ? { offset } : {}),
  };
  const bookings = useBookings(query);
  const pendingBotHolds = useBookingReviewCount().data?.pending ?? 0;
  const rows = useMemo(() => {
    const data = bookings.data?.data ?? [];
    return view === 'holds' ? [...data].sort(byExpiry) : data;
  }, [bookings.data, view]);
  // Suggested tags, the tags on this page and the active filter, in that order.
  const tagOptions = useMemo(
    () =>
      normalizeBookingTags([
        ...suggested,
        ...(bookings.data?.data ?? []).flatMap((b) => b.tags),
        ...(tag !== ANY_TAG ? [tag] : []),
      ]),
    [suggested, bookings.data, tag],
  );
  const reset =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setOffset(0);
    };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="text-xl font-semibold">{t('lodging.bookingsTitle')}</h1>
        <div className="flex flex-wrap items-center gap-3">
          {canManageCatalog && <HoldMinutesControl />}
          {canManageOrders && (
            <Button size="sm" onClick={() => setSheet({ key: Date.now(), mode: 'create' })}>
              <Plus aria-hidden />
              {t('lodging.list.create')}
            </Button>
          )}
        </div>
      </div>
      <Tabs value={view} onValueChange={(v) => reset(setView)(v as View)}>
        <TabsList variant="line" className="w-full justify-start overflow-x-auto border-b">
          {VIEWS.map((v) => (
            <TabsTrigger key={v} value={v} className="flex-none px-3">
              {t(`lodging.list.tabs.${v}`)}
              {v === 'holds' && pendingBotHolds > 0 && (
                <>
                  {' '}
                  <span
                    aria-hidden
                    className="rounded-full bg-warning-soft px-1.5 text-xs font-semibold tabular-nums text-warning"
                  >
                    {pendingBotHolds}
                  </span>
                  <span className="sr-only">
                    {t('lodging.list.pendingBotHolds', { count: pendingBotHolds })}
                  </span>
                </>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-80">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            aria-label={t('lodging.list.searchLabel')}
            placeholder={t('lodging.list.search')}
            className="h-8 pl-8"
            maxLength={100}
            value={q}
            onChange={(e) => reset(setQ)(e.target.value)}
          />
        </div>
        <Select value={propertyId} onValueChange={reset(setPropertyId)}>
          <SelectTrigger size="sm" className="w-44" aria-label={t('lodging.list.property')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('lodging.list.allProperties')}</SelectItem>
            {properties.data?.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.code} · {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tag} onValueChange={reset(setTag)}>
          <SelectTrigger size="sm" className="w-40" aria-label={t('lodging.list.tag')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_TAG}>{t('lodging.list.allTags')}</SelectItem>
            {tagOptions.map((x) => (
              <SelectItem key={x} value={x}>
                {x}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={reset(setSource)}>
          <SelectTrigger size="sm" className="w-36" aria-label={t('lodging.list.source')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('lodging.list.allSources')}</SelectItem>
            {BookingSourceEnum.options.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`lodging.source.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {view === 'all' && (
          <Select value={status} onValueChange={reset(setStatus)}>
            <SelectTrigger size="sm" className="w-40" aria-label={t('lodging.list.status')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('lodging.list.allStatuses')}</SelectItem>
              {BookingStatusEnum.options.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`lodging.bookingStatus.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {bookings.isPending ? (
        <div className="grid gap-1.5" role="status" aria-label={t('lodging.loading')}>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : bookings.isError ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription className="flex flex-wrap items-center gap-2">
            {t('lodging.loadError')}
            <Button size="xs" variant="outline" onClick={() => void bookings.refetch()}>
              {t('lodging.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border px-4 py-8 text-center text-sm text-muted-foreground">
          {t(`lodging.list.empty.${view}`)}
        </p>
      ) : (
        <div className="rounded-lg border">
          <BookingsTable
            bookings={rows}
            showExpiry={view === 'holds'}
            onTag={(t) => reset(setTag)(normalizeBookingTag(t))}
            onOpen={(bookingId) => setSheet({ key: Date.now(), mode: 'view', bookingId })}
          />
        </div>
      )}
      {(offset > 0 || bookings.data?.nextOffset) && (
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 100))}
          >
            <ChevronLeft aria-hidden />
            {t('lodging.list.prev')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!bookings.data?.nextOffset}
            onClick={() => setOffset(bookings.data?.nextOffset ?? offset)}
          >
            {t('lodging.list.next')}
            <ChevronRight aria-hidden />
          </Button>
        </div>
      )}
      {sheet?.mode === 'create' && (
        <BookingSheet
          key={sheet.key}
          mode="create"
          open
          onOpenChange={(o) => !o && setSheet(null)}
        />
      )}
      {sheet?.mode === 'view' && (
        <BookingSheet
          key={sheet.key}
          mode="view"
          open
          bookingId={sheet.bookingId}
          onOpenChange={(o) => !o && setSheet(null)}
        />
      )}
    </div>
  );
}
