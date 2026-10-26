import type { SeatUsage } from '@agent-sales/contracts';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

/** "Thành viên 2/5" with a bar; waiting invitations count towards the bar too. */
export function SeatMeter({ seats }: { seats: SeatUsage }) {
  const { t } = useTranslation();
  const { used, pending, limit } = seats;
  if (limit === null) {
    return <p className="text-sm text-muted-foreground">{t('team.seatsUnlimited', { used })}</p>;
  }
  const pct = (n: number) => Math.min(100, Math.round((n / Math.max(limit, 1)) * 100));
  const full = used + pending >= limit;
  return (
    <div className="flex max-w-md flex-col gap-1.5" data-testid="seat-meter">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{t('team.seats', { used, limit })}</span>
        {pending ? (
          <span className="text-xs text-muted-foreground">
            {t('team.seatsPending', { count: pending })}
          </span>
        ) : null}
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
        aria-label={t('team.seats', { used, limit })}
        className="flex h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn('h-full', full ? 'bg-warning' : 'bg-primary')}
          style={{ width: `${pct(used)}%` }}
        />
        <div
          className="h-full bg-primary/30"
          style={{ width: `${Math.min(pct(pending), 100 - pct(used))}%` }}
        />
      </div>
    </div>
  );
}
