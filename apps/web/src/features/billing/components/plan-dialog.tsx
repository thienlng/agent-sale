import type { EntitlementsDto } from '@agent-sales/contracts';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumber } from '@/lib/format';

import { useEntitlements } from '../api/use-entitlements';

/** Limits worth showing a shop owner, in display order; other keys stay internal. */
const LIMITS = ['members.max', 'channels.max', 'contacts.max', 'knowledge_items.max'] as const;

type Status = EntitlementsDto['status'];

const STATUS_VARIANT: Record<Status, 'secondary' | 'destructive' | 'outline'> = {
  trialing: 'secondary',
  active: 'secondary',
  past_due: 'destructive',
  suspended: 'destructive',
  canceled: 'outline',
};

function formatDay(iso: string, lang: string): string {
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
}

function PlanBody({ data }: { data: EntitlementsDto }) {
  const { t, i18n } = useTranslation();
  const limit = (v: number | null) => (v === null ? t('billing.plan.unlimited') : formatNumber(v));
  const ai = data.aiIncludedMessages;
  const rows = [
    ...(ai
      ? [
          {
            key: 'ai',
            label: t('billing.plan.limits.ai'),
            value: t('billing.plan.aiPerPeriod', {
              amount: formatNumber(ai.amount),
              days: ai.periodDays,
            }),
          },
        ]
      : []),
    ...LIMITS.filter((k) => k in data.limits).map((k) => ({
      key: k,
      label: t(`billing.plan.limits.${k.replace('.max', '')}`),
      // Present (filtered above); `null` means unlimited, so no `?? 0` here.
      value: limit(data.limits[k] as number | null),
    })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 rounded-lg border bg-muted/40 p-4">
        <span className="text-xs text-muted-foreground">{t('billing.plan.current')}</span>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xl font-semibold">{data.plan.name}</span>
          <Badge variant={STATUS_VARIANT[data.status]}>
            {t(`billing.plan.status.${data.status}`)}
          </Badge>
        </div>
        {data.periodEnd ? (
          <span className="text-sm text-muted-foreground">
            {t(data.status === 'trialing' ? 'billing.plan.trialEnds' : 'billing.plan.periodEnds', {
              date: formatDay(data.periodEnd, i18n.language),
            })}
          </span>
        ) : null}
      </div>
      {rows.length > 0 ? (
        <section aria-labelledby="plan-limits" className="flex flex-col gap-2">
          <h3 id="plan-limits" className="text-sm font-medium">
            {t('billing.plan.includes')}
          </h3>
          <dl className="divide-y rounded-lg border">
            {rows.map((r) => (
              <div key={r.key} className="flex items-center justify-between gap-4 px-4 py-2.5">
                <dt className="text-sm text-muted-foreground">{r.label}</dt>
                <dd className="text-sm font-medium tabular-nums">{r.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
}

/** "Plan and billing" popup opened from the account menu: current plan, status and limits. */
export function PlanDialog({
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: ((event: Event) => void) | undefined;
}) {
  const { t } = useTranslation();
  const query = useEntitlements({ enabled: open });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t('billing.plan.title')}</DialogTitle>
          <DialogDescription>{t('billing.plan.subtitle')}</DialogDescription>
        </DialogHeader>
        {query.data ? (
          <PlanBody data={query.data} />
        ) : query.isError ? (
          <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-4">
            <p className="text-sm">{t('billing.plan.loadError')}</p>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              {t('billing.plan.retry')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3" aria-busy="true">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-36 w-full" />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('billing.plan.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
