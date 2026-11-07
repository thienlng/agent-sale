import type { BookingDto } from '@agent-sales/contracts';
import { Bot } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import { dayMonth, formatVnd } from '../../lib/format';
import type { RangeStats, StayEvent } from '../../lib/property-calendar-model';
import { HoldExpiry } from '../bookings-table';

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="grid min-w-0 content-start gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
      {hint && <dd className="text-[11px] text-muted-foreground">{hint}</dd>}
    </div>
  );
}

interface Line {
  bookingId: string;
  code: string;
  guestName: string;
  night: string;
  extra?: ReactNode;
}

function BookingLines({
  title,
  lines,
  onOpen,
}: {
  title?: string;
  lines: Line[];
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation('lodging');
  return (
    <section className="grid min-w-0 gap-1.5">
      {title && <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>}
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('pcal.stats.none')}</p>
      ) : (
        <ul className="grid min-w-0 gap-1">
          {lines.map((l) => (
            <li key={l.bookingId} className="min-w-0">
              <button
                type="button"
                aria-label={t('pcal.stats.openBooking', { code: l.code })}
                className="flex min-h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                onClick={() => onOpen(l.bookingId)}
              >
                <span className="w-11 shrink-0 tabular-nums text-muted-foreground">
                  {dayMonth(l.night)}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{l.guestName || l.code}</span>
                {l.extra}
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
  checkIns: StayEvent[];
  checkOuts: StayEvent[];
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
        <BookingLines title={t('pcal.stats.checkIns')} lines={checkIns} onOpen={onOpenBooking} />
        <BookingLines title={t('pcal.stats.checkOuts')} lines={checkOuts} onOpen={onOpenBooking} />
        <section className="grid min-w-0 gap-1.5">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Bot aria-hidden className="size-3.5" />
            {t('pcal.stats.botHolds')}
          </h3>
          {botHolds.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('pcal.stats.botHoldsNone')}</p>
          ) : (
            <BookingLines
              lines={botHolds.map((b) => ({
                bookingId: b.id,
                code: b.code,
                guestName: b.guestName,
                night: b.checkIn,
                extra: (
                  <span className="shrink-0 text-xs">
                    <HoldExpiry at={b.holdExpiresAt} now={now} />
                  </span>
                ),
              }))}
              onOpen={onOpenBooking}
            />
          )}
        </section>
      </CardContent>
    </Card>
  );
}
