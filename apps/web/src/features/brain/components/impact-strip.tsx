import type { ImpactRange, ImpactResponse } from '@agent-sales/contracts';
import { TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { formatVnd } from '@/lib/format';

import { useImpact } from '../api/care';

const RANGES: ImpactRange[] = ['today', '7d', '30d'];

/** 8 400 000 → "8,4 triệu" (vi) / "₫8.4 million" (en); under a million, the full amount. */
function useMoney() {
  const { t, i18n } = useTranslation('brain');
  return (amount: number) =>
    amount < 1_000_000
      ? formatVnd(amount)
      : t('impact.money', {
          amount: new Intl.NumberFormat(i18n.language === 'en' ? 'en-US' : 'vi-VN', {
            notation: 'compact',
            compactDisplay: 'long',
            maximumFractionDigits: 1,
          }).format(amount),
        });
}

function isEmpty(r: ImpactResponse): boolean {
  return r.ai.orders + r.aiStaff.orders === 0 && r.followUpsSent === 0;
}

/**
 * "Rapiz đã mang lại" (spec 2026-11-11 care §6): orders and revenue that followed an AI touch,
 * AI alone vs AI + staff, for today / 7 days / 30 days. Whole-business figures, so only roles
 * with `analytics.view` and `contacts.view_all` see it (the page decides). Nothing yet: a short
 * explainer instead of zeros; follow-ups but no sale yet: the follow-ups lead. A hotel's sales
 * are stay bookings (`bookings`). On the statistics page the period is the report's (`range`).
 */
export function ImpactStrip({
  bookings = false,
  range: fixedRange,
  hideWhenEmpty = false,
}: {
  bookings?: boolean;
  /** The page's period: the strip follows it and offers no picker of its own (MS-23, TM-12). */
  range?: ImpactRange | undefined;
  /** An education or spa business records requests, not orders: an empty strip says nothing. */
  hideWhenEmpty?: boolean;
}) {
  const { t } = useTranslation('brain');
  const [ownRange, setRange] = useState<ImpactRange>('30d');
  const range = fixedRange ?? ownRange;
  const impact = useImpact(range);
  const money = useMoney();
  const r = impact.data;
  if (impact.isError || (hideWhenEmpty && r && isEmpty(r))) return null;
  const orders = r ? r.ai.orders + r.aiStaff.orders : 0;
  const unit = bookings ? 'bookings' : 'orders';
  return (
    <section
      aria-labelledby="impact-title"
      className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-brand-text">
          <TrendingUp className="size-4" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id="impact-title" className="sr-only">
            {t('impact.title')}
          </h2>
          {!r ? (
            <Skeleton className="my-1 h-5 w-64 max-w-full" />
          ) : isEmpty(r) ? (
            <p className="text-sm text-muted-foreground">{t(`impact.empty.${unit}`)}</p>
          ) : orders === 0 ? (
            <p className="text-sm font-semibold break-words">
              {t(`impact.followUpsHeadline.${range}`, {
                count: r.followUpsSent,
                replies: r.repliesReceived,
              })}
            </p>
          ) : (
            <>
              <p className="text-sm font-semibold break-words">
                {t(`impact.headline.${unit}.${range}`, {
                  count: orders,
                  revenue: money(r.ai.revenue + r.aiStaff.revenue),
                })}
              </p>
              <p className="text-xs text-muted-foreground break-words">
                {t(`impact.split.${unit}`, {
                  aiOrders: r.ai.orders,
                  aiRevenue: money(r.ai.revenue),
                  staffOrders: r.aiStaff.orders,
                  staffRevenue: money(r.aiStaff.revenue),
                })}
                {r.followUpsSent > 0
                  ? ` · ${t('impact.followUps', { count: r.followUpsSent, replies: r.repliesReceived })}`
                  : ''}
              </p>
            </>
          )}
        </div>
      </div>
      {fixedRange ? null : (
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          className="ml-11 shrink-0 self-start sm:ml-0 sm:self-center"
          value={range}
          onValueChange={(v) => v && setRange(v as ImpactRange)}
          aria-label={t('impact.range')}
        >
          {RANGES.map((k) => (
            <ToggleGroupItem key={k} value={k}>
              {t(`impact.ranges.${k}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
    </section>
  );
}
