import { type BookingDto, BookingStatus as BookingStatusEnum } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, CircleAlert, MessageCircle, Phone } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

import { useBookings } from '../../api/bookings';
import { botHoldPending } from '../../lib/bot-hold';
import { dayMonth, formatVnd, nightsBetween } from '../../lib/format';
import { BookingStatusBadge } from '../booking-status-badge';
import { BotBadge } from '../bookings-table';

type ListFilter = 'upcoming' | 'past' | 'all';

/** "06/11", or "06/11/2025" outside the current year. */
const stayDate = (night: string, today: string) =>
  night.slice(0, 4) === today.slice(0, 4)
    ? dayMonth(night)
    : `${dayMonth(night)}/${night.slice(0, 4)}`;
const FILTERS: ListFilter[] = ['upcoming', 'past', 'all'];
const ALL = '__all__';

/**
 * Danh sách: the property's bookings (Sắp tới / Đã qua / Tất cả, and a status), with dates,
 * guest, phone, packages, total, status, source and the conversation link. "Đã qua" lists the
 * stays of the server's `past` view (check-out today or earlier, latest check-in first).
 */
export function PropertyBookingsList({
  propertyId,
  roomId,
  today,
  onOpen,
}: {
  propertyId: string;
  /** Room in scope: only its bookings (and whole-place ones). */
  roomId: string | null;
  today: string;
  onOpen: (bookingId: string) => void;
}) {
  const { t } = useTranslation('lodging');
  const [filter, setFilter] = useState<ListFilter>('upcoming');
  const [status, setStatus] = useState<string>(ALL);
  const [offset, setOffset] = useState(0);
  const parsedStatus = BookingStatusEnum.safeParse(status);
  const bookings = useBookings({
    view: filter,
    propertyId,
    ...(parsedStatus.success ? { status: parsedStatus.data } : {}),
    ...(offset ? { offset } : {}),
  });
  const rows = (bookings.data?.data ?? []).filter(
    (b) => !roomId || b.whole || b.unitIds.includes(roomId),
  );
  const reset =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setOffset(0);
    };

  return (
    <div className="grid gap-3" data-testid="pcal-list">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          aria-label={t('pcal.list.filter')}
          value={filter}
          onValueChange={(v) => {
            const next = FILTERS.find((f) => f === v);
            if (next) reset(setFilter)(next);
          }}
        >
          {FILTERS.map((f) => (
            <ToggleGroupItem key={f} value={f}>
              {t(`pcal.list.${f}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Select value={status} onValueChange={reset(setStatus)}>
          <SelectTrigger size="sm" className="w-44" aria-label={t('list.status')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('list.allStatuses')}</SelectItem>
            {BookingStatusEnum.options.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`bookingStatus.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {bookings.isPending ? (
        <div className="grid gap-1.5" role="status" aria-label={t('loading')}>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : bookings.isError ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription className="flex flex-wrap items-center gap-2">
            {t('loadError')}
            <Button size="xs" variant="outline" onClick={() => void bookings.refetch()}>
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {t('pcal.list.empty')}
        </p>
      ) : (
        <ul className="grid divide-y divide-border rounded-lg border border-border">
          {rows.map((b) => (
            <BookingLine key={b.id} booking={b} today={today} onOpen={onOpen} />
          ))}
        </ul>
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
            {t('list.prev')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!bookings.data?.nextOffset}
            onClick={() => setOffset(bookings.data?.nextOffset ?? offset)}
          >
            {t('list.next')}
            <ChevronRight aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}

/** One booking: a click anywhere opens the sheet; the code button does it for the keyboard. */
function BookingLine({
  booking: b,
  today,
  onOpen,
}: {
  booking: BookingDto;
  today: string;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation('lodging');
  const block = b.kind === 'block';
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <li
      data-booking={b.code}
      className="grid cursor-pointer gap-x-4 gap-y-1.5 px-3 py-2.5 text-sm hover:bg-muted/50 lg:grid-cols-[8rem_minmax(0,1fr)_8rem_11.5rem_8rem] lg:items-center"
      onClick={() => onOpen(b.id)}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 tabular-nums lg:block">
        <button
          type="button"
          className="rounded-sm font-semibold hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={(e) => {
            stop(e);
            onOpen(b.id);
          }}
        >
          {b.code}
        </button>
        <span className="block">
          {stayDate(b.checkIn, today)} → {stayDate(b.checkOut, today)}
        </span>
        <span className="block text-xs text-muted-foreground">
          {t('list.nights', { count: nightsBetween(b.checkIn, b.checkOut) })}
        </span>
      </div>
      <div className="grid min-w-0 content-start gap-0.5">
        {block ? (
          <span className="text-muted-foreground">
            {t('list.block', { reason: b.blockReason })}
          </span>
        ) : (
          <>
            <span className="truncate font-medium" title={b.guestName}>
              {b.guestName}
            </span>
            {b.guestPhone && (
              <a
                href={`tel:${b.guestPhone}`}
                aria-label={t('pcal.list.call', { phone: b.guestPhone })}
                className="inline-flex w-fit items-center gap-1 text-xs tabular-nums text-muted-foreground hover:text-foreground hover:underline"
                onClick={stop}
              >
                <Phone aria-hidden className="size-3" />
                {b.guestPhone}
              </a>
            )}
            {b.packageNames.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {t('pcal.list.packages', { names: b.packageNames.join(', ') })}
              </span>
            )}
            {!b.whole && b.unitNames.length > 0 && (
              <span className="truncate text-xs text-muted-foreground">
                {b.unitNames.join(', ')}
              </span>
            )}
          </>
        )}
      </div>
      {/* Phones: one wrapping line; wider screens: aligned columns of the row grid. */}
      <div className="flex flex-wrap items-center gap-1.5 lg:contents">
        <span className="font-medium tabular-nums lg:text-right">
          {block ? '' : b.totalSell === null ? '—' : formatVnd(b.totalSell)}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <BookingStatusBadge status={b.status} />
          {b.source === 'bot' ? (
            <BotBadge pending={botHoldPending(b)} />
          ) : (
            b.source && (
              <span className="text-xs text-muted-foreground">{t(`source.${b.source}`)}</span>
            )
          )}
        </span>
        <span className="lg:justify-self-end">
          {b.conversationId && (
            <Button asChild size="xs" variant="outline">
              <Link to="/app/inbox" search={{ conversation: b.conversationId }} onClick={stop}>
                <MessageCircle aria-hidden />
                {t('sheet.conversation')}
              </Link>
            </Button>
          )}
        </span>
      </div>
    </li>
  );
}
