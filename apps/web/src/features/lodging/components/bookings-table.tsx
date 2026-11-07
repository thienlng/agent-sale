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
import { cn } from '@/lib/utils';

import { botHoldPending } from '../lib/bot-hold';
import { clockTime, dayMonth, formatVnd, nightsBetween } from '../lib/format';
import { BookingStatusBadge } from './booking-status-badge';
import { TagChips } from './tag-input';

const SOON_MS = 15 * 60_000;

/** Expiry cell of a hold: "Quá hạn" when past, red when under 15 minutes. */
export function HoldExpiry({ at, now }: { at: string | null; now: number }) {
  const { t } = useTranslation('lodging');
  if (!at) return null;
  const left = new Date(at).getTime() - now;
  if (left <= 0) return <span className="font-semibold text-destructive">{t('list.overdue')}</span>;
  const date = new Date(at);
  const sameDay = left < 24 * 3_600_000;
  return (
    <span className={cn('tabular-nums', left < SOON_MS && 'font-semibold text-destructive')}>
      {sameDay
        ? t('list.expiresAt', { time: clockTime(at) })
        : t('list.expiresOn', {
            date: new Intl.DateTimeFormat('vi-VN', {
              timeZone: 'Asia/Ho_Chi_Minh',
              day: '2-digit',
              month: '2-digit',
            }).format(date),
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

/** Booking rows; a row (or its code button, for the keyboard) opens the booking sheet. */
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
                    className="rounded-sm font-semibold tabular-nums hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
                  {dayMonth(b.checkIn)} → {dayMonth(b.checkOut)}
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
