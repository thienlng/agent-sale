import type { SaasSubscriptionDto } from '@agent-sales/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDay, formatNumber, formatVnd, isoDate } from '@/lib/format';
import { useCan } from '@/lib/permissions';

import { useContactSubscription, useSubscriptionHistory } from '../api/saas';
import { SubscriptionForm } from './subscription-form';

/** A customer's plan on their profile; revenue figures need `contacts.view_all`. */
export function SubscriptionCard({ contactId }: { contactId: string }) {
  const canView = useCan('contacts.view_all');
  if (!canView) return null;
  return <SubscriptionCardBody contactId={contactId} />;
}

function SubscriptionCardBody({ contactId }: { contactId: string }) {
  const { t } = useTranslation(),
    query = useContactSubscription(contactId),
    canEdit = useCan('contacts.edit');
  const [editing, setEditing] = useState(false),
    [showHistory, setShowHistory] = useState(false);
  const sub = query.data?.subscription ?? null;
  return (
    <section className="space-y-3 rounded-xl border p-4" aria-labelledby="saas-subscription">
      <div className="flex items-center justify-between gap-2">
        <h3 id="saas-subscription" className="font-semibold">
          {t('saas.sub.title')}
        </h3>
        {sub ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {sub.linked ? (
              <Badge variant="outline" title={t('saas.sub.linkedLabel')}>
                {t('saas.sub.linked')}
              </Badge>
            ) : null}
            {sub.upsell ? <Badge variant="default">{t('saas.sub.upsell')}</Badge> : null}
            <StageBadge stage={sub.stage} />
          </div>
        ) : null}
      </div>
      {query.isPending ? (
        <p role="status" className="text-sm">
          {t('saas.loading')}
        </p>
      ) : query.isError ? (
        <div role="alert" className="flex items-center gap-2 text-sm">
          {t('saas.loadError')}
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
            {t('saas.retry')}
          </Button>
        </div>
      ) : editing ? (
        <SubscriptionForm
          key={sub?.version ?? 0}
          contactId={contactId}
          current={sub}
          onSaved={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          {sub ? <SubscriptionFacts sub={sub} /> : <p className="text-sm">{t('saas.sub.none')}</p>}
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                {t(sub ? 'saas.sub.edit' : 'saas.sub.add')}
              </Button>
            )}
            {sub ? (
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={showHistory}
                onClick={() => setShowHistory((v) => !v)}
              >
                {t('saas.history.toggle')}
              </Button>
            ) : null}
          </div>
          {sub && showHistory ? <SubscriptionHistory contactId={contactId} /> : null}
        </>
      )}
    </section>
  );
}

export function StageBadge({ stage }: { stage: SaasSubscriptionDto['stage'] }) {
  const { t } = useTranslation();
  return (
    <Badge
      variant={stage === 'active' ? 'default' : stage === 'past_due' ? 'destructive' : 'secondary'}
    >
      {t(`saas.stage.${stage}`)}
    </Badge>
  );
}

function SubscriptionFacts({ sub }: { sub: SaasSubscriptionDto }) {
  const { t } = useTranslation();
  const facts: [string, string | null][] = [
    ['planName', sub.planName],
    ['billingPeriod', t(`saas.period.${sub.billingPeriod}`)],
    ['mrr', formatVnd(sub.mrr)],
    ['seats', sub.seats === null ? null : String(sub.seats)],
    ['trialEndsOn', sub.trialEndsOn && formatDay(sub.trialEndsOn)],
    ['startedOn', sub.startedOn && formatDay(sub.startedOn)],
    ['renewsOn', sub.renewsOn && formatDay(sub.renewsOn)],
    ['canceledOn', sub.canceledOn && formatDay(sub.canceledOn)],
    ['externalRef', sub.externalRef],
    ['usage', sub.usage && `${formatNumber(sub.usage.used)} / ${formatNumber(sub.usage.limit)}`],
    ['churnReason', sub.churnReason && t(`saas.churn.${sub.churnReason}`)],
    ['churnNote', sub.churnNote || null],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      {facts.map(([key, value]) =>
        value ? (
          <div key={key} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t(`saas.sub.${key}`)}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ) : null,
      )}
      {sub.note ? <p className="col-span-2 whitespace-pre-wrap">{sub.note}</p> : null}
    </dl>
  );
}

/** Plan, stage and MRR changes, newest first (spec §6.2). */
function SubscriptionHistory({ contactId }: { contactId: string }) {
  const { t } = useTranslation(),
    query = useSubscriptionHistory(contactId, true);
  if (query.isPending)
    return (
      <p role="status" className="text-sm">
        {t('saas.loading')}
      </p>
    );
  if (query.isError)
    return (
      <p role="alert" className="text-sm">
        {t('saas.loadError')}
      </p>
    );
  const rows = query.data.data;
  if (!rows.length)
    return <p className="text-sm text-muted-foreground">{t('saas.history.none')}</p>;
  return (
    <ol className="space-y-1.5 border-l pl-3 text-sm" aria-label={t('saas.history.title')}>
      {rows.map((r) => (
        <li key={r.id}>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatDay(isoDate(new Date(r.changedAt)))} · {t(`saas.history.source.${r.source}`)}
          </span>
          <span className="block">
            {r.fromStage ? `${t(`saas.stage.${r.fromStage}`)} → ` : ''}
            {t(`saas.stage.${r.toStage}`)} · {r.toPlan} · {formatVnd(r.toMrr)}
            {r.churnReason ? ` · ${t(`saas.churn.${r.churnReason}`)}` : ''}
          </span>
        </li>
      ))}
    </ol>
  );
}
