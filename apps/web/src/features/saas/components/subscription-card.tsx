import type { SaasSubscriptionDto } from '@agent-sales/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDay, formatVnd } from '@/lib/format';
import { useCan } from '@/lib/permissions';

import { useContactSubscription } from '../api/saas';
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
  const [editing, setEditing] = useState(false);
  const sub = query.data?.subscription ?? null;
  return (
    <section className="space-y-3 rounded-xl border p-4" aria-labelledby="saas-subscription">
      <div className="flex items-center justify-between gap-2">
        <h3 id="saas-subscription" className="font-semibold">
          {t('saas.sub.title')}
        </h3>
        {sub && <StageBadge stage={sub.stage} />}
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
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              {t(sub ? 'saas.sub.edit' : 'saas.sub.add')}
            </Button>
          )}
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
