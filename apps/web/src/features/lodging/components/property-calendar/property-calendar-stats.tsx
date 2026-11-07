import type { BookingDto } from '@agent-sales/contracts';
import { Bot } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import { dayMonth, formatVnd } from '../../lib/format';
import type { RangeStats } from '../../lib/property-calendar-model';
import { HoldExpiry } from '../bookings-table';

const LIST_MAX = 5;

/** Bookings of the property that matter for the panel, from the upcoming list. */
export function panelBookings(
  bookings: BookingDto[],
  range: { from: string; to: string; today: string },
) {
  const stays = bookings.filter((b) => b.kind === 'stay');
  const after = range.from > range.today ? range.from : range.today;
  const checkIns = stays
    .filter((b) => b.checkIn >= after && b.checkIn < range.to)
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn))
    .slice(0, LIST_MAX);
  const checkOuts = stays
    .filter((b) => b.checkOut >= after && b.checkOut < range.to)
    .sort((a, b) => a.checkOut.localeCompare(b.checkOut))
    .slice(0, LIST_MAX);
  return { checkIns, checkOuts };
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="grid min-w-0 content-start gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
      {hint && <dd className="text-[11px] text-muted-foreground">{hint}</dd>}
    </div>
  );
}

function BookingLines({
  title,
  bookings,
  date,
  onOpen,
  children,
}: {
  title?: string;
  bookings: BookingDto[];
  date: (b: BookingDto) => string;
  onOpen: (id: string) => void;
  children?: (b: BookingDto) => ReactNode;
}) {
  const { t } = useTranslation('lodging');
  return (
    <section className="grid min-w-0 gap-1.5">
      {title && <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>}
      {bookings.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('pcal.stats.none')}</p>
      ) : (
        <ul className="grid min-w-0 gap-1">
          {bookings.map((b) => (
            <li key={b.id} className="min-w-0">
              <button
                type="button"
                aria-label={t('pcal.stats.openBooking', { code: b.code })}
                className="flex min-h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                onClick={() => onOpen(b.id)}
              >
                <span className="w-11 shrink-0 tabular-nums text-muted-foreground">{date(b)}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{b.guestName || b.code}</span>
                {children?.(b)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Side panel of "Lịch căn" for the shown range: occupancy, nights sold, booked revenue, the
 * next check-ins and check-outs, and the bot holds waiting for staff.
 */
export function PropertyCalendarStats({
  stats,
  checkIns,
  checkOuts,
  botHolds,
  dimmed,
  onOpenBooking,
}: {
  stats: RangeStats;
  checkIns: BookingDto[];
  checkOuts: BookingDto[];
  botHolds: BookingDto[];
  /** True while the previous range's data is still shown. */
  dimmed: boolean;
  onOpenBooking: (bookingId: string) => void;
}) {
  const { t } = useTranslation('lodging');
  const now = Date.now();
  return (
    <Card
      className={cn('min-w-0 gap-4 py-4', dimmed && 'opacity-60')}
      aria-busy={dimmed}
      data-testid="pcal-stats"
    >
      <CardHeader className="px-4">
        <CardTitle className="text-sm">{t('pcal.stats.title')}</CardTitle>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-4 px-4">
        <dl className="grid min-w-0 grid-cols-2 gap-3 xl:grid-cols-1 2xl:grid-cols-2">
          <Figure
            label={t('pcal.stats.occupancy')}
            value={`${stats.pct}%`}
            hint={t('pcal.stats.occupancyHint', {
              taken: stats.takenNights,
              total: stats.totalNights,
            })}
          />
          <Figure label={t('pcal.stats.nightsSold')} value={String(stats.nightsSold)} />
          <div className="col-span-2 xl:col-span-1 2xl:col-span-2">
            <Figure
              label={t('pcal.stats.revenue')}
              value={formatVnd(stats.revenue)}
              hint={t('pcal.stats.revenueHint')}
            />
          </div>
        </dl>
        <BookingLines
          title={t('pcal.stats.checkIns')}
          bookings={checkIns}
          date={(b) => dayMonth(b.checkIn)}
          onOpen={onOpenBooking}
        />
        <BookingLines
          title={t('pcal.stats.checkOuts')}
          bookings={checkOuts}
          date={(b) => dayMonth(b.checkOut)}
          onOpen={onOpenBooking}
        />
        <section className="grid min-w-0 gap-1.5">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Bot aria-hidden className="size-3.5" />
            {t('pcal.stats.botHolds')}
          </h3>
          {botHolds.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('pcal.stats.botHoldsNone')}</p>
          ) : (
            <BookingLines
              bookings={botHolds}
              date={(b) => dayMonth(b.checkIn)}
              onOpen={onOpenBooking}
            >
              {(b) => (
                <span className="shrink-0 text-xs">
                  <HoldExpiry at={b.holdExpiresAt} now={now} />
                </span>
              )}
            </BookingLines>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
