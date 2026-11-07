import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

import { dayMonth, formatShortVnd, weekdayLong } from '../../lib/format';
import {
  compactState,
  type DayInfo,
  type DayState,
  monthWeeks,
  type SummaryState,
} from '../../lib/property-calendar-model';
import { STATUS_STYLE } from '../booking-status-badge';

type CompactState = DayState | SummaryState;

/** Cell look per state; booking states reuse the grid's status styles (pattern + colour). */
const STATE_CLASS: Record<CompactState, string> = {
  free: 'border-border bg-background text-foreground',
  partial: 'border-primary/40 bg-half-primary text-primary-strong',
  full: 'border-muted-foreground/30 bg-hatch-muted text-muted-foreground',
  hold: STATUS_STYLE.hold.className,
  confirmed: STATUS_STYLE.confirmed.className,
  checked_in: STATUS_STYLE.checked_in.className,
  checked_out: STATUS_STYLE.checked_out.className,
  blocked: STATUS_STYLE.active.className,
};

const SINGLE_LEGEND: CompactState[] = ['free', 'hold', 'confirmed', 'checked_in', 'blocked'];
const SUMMARY_LEGEND: CompactState[] = ['free', 'partial', 'full'];

/** Colour key of the compact months. */
export function StateLegend({ summary }: { summary: boolean }) {
  const { t } = useTranslation('lodging');
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {(summary ? SUMMARY_LEGEND : SINGLE_LEGEND).map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <span aria-hidden className={cn('size-3.5 rounded-sm border', STATE_CLASS[s])} />
          {t(`pcal.legend.${s}`)}
        </span>
      ))}
    </div>
  );
}

function stateText(t: TFunction, state: CompactState, day?: DayInfo) {
  if (state === 'partial' && day) return t('pcal.freeOf', { free: day.free, total: day.total });
  return t(`pcal.legend.${state}`);
}

const monthYear = (month: string) => ({ month: month.slice(5, 7), year: month.slice(0, 4) });

/**
 * 3 tháng: one compact month. The title opens its Tháng view; a taken day opens its booking,
 * any other day opens the Tháng view of the month.
 */
export function QuarterMonth({
  month,
  days,
  summary,
  today,
  pct,
  onOpenMonth,
  onOpenBooking,
}: {
  month: string;
  days: Map<string, DayInfo>;
  summary: boolean;
  today: string;
  pct: number;
  onOpenMonth: (month: string) => void;
  onOpenBooking: (bookingId: string) => void;
}) {
  const { t } = useTranslation('lodging');
  const weeks = monthWeeks(month);
  const inMonth = (n: string) => n.slice(0, 7) === month.slice(0, 7);
  return (
    <section className="grid min-w-0 content-start gap-2 rounded-lg border border-border p-2">
      <button
        type="button"
        className="flex items-baseline justify-between gap-2 rounded-sm px-1 text-left hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label={t('pcal.openMonth', { ...monthYear(month), pct })}
        onClick={() => onOpenMonth(month)}
      >
        <span className="text-sm font-semibold">{t('pcal.monthTitle', monthYear(month))}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {t('pcal.monthOccupancy', { pct })}
        </span>
      </button>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i} aria-hidden className="text-[11px] text-muted-foreground">
            {t(`weekdayShort.${i + 1}`)}
          </span>
        ))}
        {weeks.flat().map((night) => {
          if (!inMonth(night)) return <span key={night} aria-hidden />;
          const day = days.get(night);
          const state = compactState(day, summary);
          const seg = day?.segment ?? null;
          const label = `${weekdayLong(t, night)} ${dayMonth(night)}`;
          return (
            <button
              key={night}
              type="button"
              data-state={state}
              aria-label={t('pcal.dayOpenMonth', {
                date: label,
                state: seg ? `${stateText(t, state)} ${seg.code}` : stateText(t, state, day),
              })}
              className={cn(
                'flex h-10 min-w-0 flex-col items-center justify-center rounded-sm border text-xs leading-tight tabular-nums',
                STATE_CLASS[state],
                night === today && 'ring-2 ring-primary',
              )}
              onClick={() => (seg ? onOpenBooking(seg.bookingId) : onOpenMonth(month))}
            >
              <span>{Number(night.slice(8, 10))}</span>
              {state === 'free' && day && day.sell !== null && (
                <span className="max-w-full truncate text-[9px] text-muted-foreground">
                  {formatShortVnd(day.sell)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Năm: one mini month as a single button that opens its Tháng view. */
export function YearMonth({
  month,
  days,
  summary,
  today,
  pct,
  onOpenMonth,
}: {
  month: string;
  days: Map<string, DayInfo>;
  summary: boolean;
  today: string;
  pct: number;
  onOpenMonth: (month: string) => void;
}) {
  const { t } = useTranslation('lodging');
  const inMonth = (n: string) => n.slice(0, 7) === month.slice(0, 7);
  return (
    <button
      type="button"
      data-month={month}
      aria-label={t('pcal.openMonth', { ...monthYear(month), pct })}
      className="grid min-w-0 content-start gap-1.5 rounded-lg border border-border p-2 text-left hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      onClick={() => onOpenMonth(month)}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{t('pcal.monthTitle', monthYear(month))}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{pct}%</span>
      </span>
      <span aria-hidden className="grid grid-cols-7 gap-0.5">
        {monthWeeks(month)
          .flat()
          .map((night) =>
            inMonth(night) ? (
              <span
                key={night}
                className={cn(
                  'flex aspect-square min-w-0 items-center justify-center rounded-[3px] border text-[9px] tabular-nums',
                  STATE_CLASS[compactState(days.get(night), summary)],
                  night === today && 'ring-1 ring-primary',
                )}
              >
                {Number(night.slice(8, 10))}
              </span>
            ) : (
              <span key={night} />
            ),
          )}
      </span>
    </button>
  );
}
