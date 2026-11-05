import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import { type CalendarPropertyData, takenByNight } from '../lib/calendar-model';
import { dayMonth, isoWeekday } from '../lib/format';

type NightState = 'free' | 'partial' | 'taken';

function nightStates(property: CalendarPropertyData, nights: string[]): NightState[] {
  const rows = property.rows.map((row) => takenByNight(row, nights));
  return nights.map((_, i) => {
    const taken = rows.filter((r) => r[i] !== null).length;
    if (taken === 0) return 'free';
    return taken === rows.length ? 'taken' : 'partial';
  });
}

const STATE_CLASS: Record<NightState, string> = {
  free: 'border-border bg-background text-foreground',
  partial: 'border-primary/40 bg-half-primary text-primary-strong',
  taken: 'border-muted-foreground/30 bg-hatch-muted text-muted-foreground',
};

/**
 * Under 768 px: one card per property with a 7-column month grid of the displayed nights
 * (free / some rooms free / full by pattern and text) and a "Tạo booking" button.
 */
export function CalendarMobile({
  properties,
  nights,
  today,
  onCreate,
  onOpenBooking,
}: {
  properties: CalendarPropertyData[];
  nights: string[];
  today: string;
  /** Absent for members who cannot create bookings (view only). */
  onCreate?: (propertyId: string, night?: string) => void;
  /** A full night opens the booking that takes it. */
  onOpenBooking: (bookingId: string) => void;
}) {
  const { t } = useTranslation('lodging');
  const first = nights[0];
  if (!first) return null;
  const lead = isoWeekday(first) - 1;
  const legend: Array<[NightState, string]> = [
    ['free', t('cal.legendFree')],
    ['partial', t('cal.legendPartial')],
    ['taken', t('cal.legendTaken')],
  ];
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {legend.map(([state, label]) => (
          <span key={state} className="flex items-center gap-1.5">
            <span className={cn('size-4 rounded-sm border', STATE_CLASS[state])} aria-hidden />
            {label}
          </span>
        ))}
      </div>
      {properties.map((p) => {
        const states = nightStates(p, nights);
        const firstRow = p.rows[0] ? takenByNight(p.rows[0], nights) : [];
        return (
          <Card key={p.id} className="gap-3 py-3">
            <CardHeader className="px-3">
              <CardTitle className="flex min-w-0 items-baseline gap-2 text-sm">
                <span className="font-semibold">{p.code}</span>
                <span className="min-w-0 truncate font-normal text-muted-foreground">{p.name}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 px-3">
              <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
                {Array.from({ length: 7 }, (_, i) => (
                  <span key={i}>{t(`weekdayShort.${i + 1}`)}</span>
                ))}
                {Array.from({ length: lead }, (_, i) => (
                  <span key={`lead-${i}`} />
                ))}
                {nights.map((night, i) => {
                  const state = states[i] ?? 'free';
                  return (
                    <button
                      key={night}
                      type="button"
                      aria-label={`${p.code} ${dayMonth(night)}: ${legend.find(([s]) => s === state)?.[1] ?? ''}`}
                      className={cn(
                        'flex h-11 items-center justify-center rounded-md border text-xs tabular-nums',
                        STATE_CLASS[state],
                        night === today && 'ring-2 ring-primary',
                      )}
                      onClick={() => {
                        const taken = state === 'taken' ? firstRow[i] : null;
                        if (taken) onOpenBooking(taken.bookingId);
                        else onCreate?.(p.id, night);
                      }}
                    >
                      {Number(night.slice(8, 10))}
                    </button>
                  );
                })}
              </div>
              {onCreate && (
                <Button variant="outline" className="h-11" onClick={() => onCreate(p.id)}>
                  <Plus aria-hidden />
                  {t('cal.createBooking')}
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
