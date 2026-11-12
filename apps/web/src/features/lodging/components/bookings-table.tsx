import type { BookingDto } from '@agent-sales/contracts';
import { Bot } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

import { botHoldPending } from '../lib/bot-hold';
import { clockTime, formatVnd, localDayMonth, nightsBetween, stayDate } from '../lib/format';
import { BookingStatusBadge } from './booking-status-badge';
import { TagChips } from './tag-input';

/** Expiry cell of a hold: "giữ đến 03:47" while it runs, red "Quá hạn" only once past (VL2-9). */
export function HoldExpiry({ at, now }: { at: string | null; now: number }) {
  const { t } = useTranslation('lodging');
  if (!at) return null;
  const left = new Date(at).getTime() - now;
  if (left <= 0) return <span className="font-semibold text-destructive">{t('list.overdue')}</span>;
  const sameDay = left < 24 * 3_600_000;
  return (
    <span className="tabular-nums">
      {sameDay
        ? t('list.expiresAt', { time: clockTime(at) })
        : t('list.expiresOn', {
            date: localDayMonth(at),
            time: clockTime(at),
          })}
    </span>
  );
}

/** "Bot tạo": amber while the hold waits for staff, quiet once handled. */
export function BotBadge({ pending }: { pending: boolean }) {
  const { t } = useTranslation('lodging');
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1',
        pending ? 'border-warning/40 bg-warning-soft text-warning' : 'text-muted-foreground',
      )}
    >
      <Bot className="size-3" aria-hidden />
      {t('list.botBadge')}
    </Badge>
  );
}

/**
 * Booking rows; a row (or its code button, for the keyboard) opens the booking sheet. On a
 * phone the seven columns do not fit, so each booking is a card instead (VL-A10).
 */
export function BookingsTable({
  bookings,
  showExpiry,
  onOpen,
  onTag,
}: {
  bookings: BookingDto[];
  showExpiry: boolean;
  onOpen: (id: string) => void;
  /** Clicking a tag chip filters the list by that tag. */
  onTag?: (tag: string) => void;
}) {
  const { t } = useTranslation('lodging');
  const now = Date.now();
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <ul className="divide-y">
        {bookings.map((b) => (
          <li key={b.id}>
            <BookingCard booking={b} showExpiry={showExpiry} now={now} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <Table className="min-w-[760px] text-[13px]">
      <TableHeader>
        <TableRow>
          <TableHead>{t('list.col.code')}</TableHead>
          <TableHead>{t('list.col.guest')}</TableHead>
          <TableHead>{t('list.col.property')}</TableHead>
          <TableHead>{t('list.col.dates')}</TableHead>
          <TableHead>{t('list.col.party')}</TableHead>
          <TableHead className="text-right">{t('list.col.total')}</TableHead>
          {showExpiry && <TableHead>{t('list.col.expires')}</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {bookings.map((b) => {
          const block = b.kind === 'block';
          return (
            <TableRow key={b.id} className="cursor-pointer" onClick={() => onOpen(b.id)}>
              <TableCell>
                <div className="flex flex-col items-start gap-1">
                  <button
                    type="button"
                    className="rounded-sm font-semibold tabular-nums hover:underline focus-visible:ring-2 focus-visible:ring-offset-3 focus-visible:ring-offset-background focus-visible:ring-ring focus-visible:outline-none"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(b.id);
                    }}
                  >
                    {b.code}
                  </button>
                  <BookingStatusBadge status={b.status} />
                  {b.source === 'bot' && <BotBadge pending={botHoldPending(b)} />}
                </div>
              </TableCell>
              <TableCell className="max-w-48">
                {block ? (
                  <span className="text-muted-foreground">
                    {t('list.block', { reason: b.blockReason })}
                  </span>
                ) : (
                  <>
                    <span className="block truncate font-medium" title={b.guestName}>
                      {b.guestName}
                    </span>
                    {b.guestPhone && (
                      <span className="block text-xs tabular-nums text-muted-foreground">
                        {b.guestPhone}
                      </span>
                    )}
                    <TagChips
                      tags={b.tags}
                      className="mt-1"
                      {...(onTag ? { onSelect: onTag } : {})}
                    />
                  </>
                )}
              </TableCell>
              <TableCell className="max-w-48">
                <span className="block font-medium tabular-nums">{b.propertyCode}</span>
                <span
                  className="block truncate text-xs text-muted-foreground"
                  title={b.unitNames.join(', ')}
                >
                  {b.whole ? t('sheet.whole') : b.unitNames.join(', ')}
                </span>
              </TableCell>
              <TableCell className="tabular-nums">
                <span className="block">
                  {stayDate(b.checkIn)} → {stayDate(b.checkOut)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t('list.nights', { count: nightsBetween(b.checkIn, b.checkOut) })}
                </span>
              </TableCell>
              <TableCell className="tabular-nums">
                {block
                  ? '—'
                  : t('cal.capacity', {
                      adults: b.party.adults,
                      children: b.party.childAges.length,
                    })}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {b.totalSell === null ? '—' : formatVnd(b.totalSell)}
              </TableCell>
              {showExpiry && (
                <TableCell>
                  <HoldExpiry at={b.holdExpiresAt} now={now} />
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** One booking on a phone: code + status, guest, place, dates, party, total and hold expiry. */
function BookingCard({
  booking: b,
  showExpiry,
  now,
  onOpen,
}: {
  booking: BookingDto;
  showExpiry: boolean;
  now: number;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation('lodging');
  const block = b.kind === 'block';
  return (
    <button
      type="button"
      onClick={() => onOpen(b.id)}
      className="grid w-full gap-1 px-3 py-3 text-left text-sm focus-visible:bg-muted focus-visible:outline-none"
    >
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="font-semibold tabular-nums">{b.code}</span>
        <BookingStatusBadge status={b.status} />
        {b.source === 'bot' && <BotBadge pending={botHoldPending(b)} />}
        {/* Spans, not TagChips' list: the card is a button (VL2-9: "Chat thử" on phones too). */}
        {b.tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex max-w-40 items-center truncate rounded-full border border-border bg-muted px-2 py-px text-[11px] leading-4 text-foreground"
          >
            {tag}
          </span>
        ))}
        <span className="ml-auto font-medium tabular-nums">
          {b.totalSell === null ? '—' : formatVnd(b.totalSell)}
        </span>
      </span>
      <span className="truncate font-medium">
        {block ? t('list.block', { reason: b.blockReason }) : b.guestName}
        {!block && b.guestPhone && (
          <span className="font-normal text-muted-foreground tabular-nums"> · {b.guestPhone}</span>
        )}
      </span>
      <span className="truncate text-muted-foreground">
        <span className="font-medium text-foreground tabular-nums">{b.propertyCode}</span>
        {' · '}
        {b.whole ? t('sheet.whole') : b.unitNames.join(', ')}
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-muted-foreground tabular-nums">
        <span className="text-foreground">
          {stayDate(b.checkIn)} → {stayDate(b.checkOut)}
        </span>
        <span>{t('list.nights', { count: nightsBetween(b.checkIn, b.checkOut) })}</span>
        {!block && (
          <span>
            {t('cal.capacity', { adults: b.party.adults, children: b.party.childAges.length })}
          </span>
        )}
        {showExpiry && b.holdExpiresAt && (
          <span className="ml-auto">
            <HoldExpiry at={b.holdExpiresAt} now={now} />
          </span>
        )}
      </span>
    </button>
  );
}
