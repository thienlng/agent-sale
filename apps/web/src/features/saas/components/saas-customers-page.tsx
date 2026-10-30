import { SaasStage } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatNumber, formatVnd } from '@/lib/format';
import { useCan } from '@/lib/permissions';

import { useSaasSubscriptions, useSaasSummary } from '../api/saas';
import { StageBadge } from './subscription-card';

const ALL = 'all';

/** Subscribers and their revenue; plans are edited on each customer's profile. */
export function SaasCustomersPage() {
  const { t } = useTranslation();
  if (!useCan('contacts.view_all')) return <p role="alert">{t('saas.revenuePermission')}</p>;
  return (
    <div className="flex w-full min-w-0 flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">{t('saas.customersTitle')}</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t('saas.customersIntro')}</p>
      </div>
      <SummaryCards />
      <SubscriptionsTable />
    </div>
  );
}

function SummaryCards() {
  const { t } = useTranslation(),
    summary = useSaasSummary();
  const s = summary.data;
  if (summary.isError)
    return (
      <div role="alert" className="flex items-center gap-3">
        {t('saas.loadError')}
        <Button variant="outline" onClick={() => void summary.refetch()}>
          {t('saas.retry')}
        </Button>
      </div>
    );
  const cards: [string, string][] = s
    ? [
        ['mrr', formatVnd(s.mrr)],
        ['active', formatNumber(s.stages.active)],
        ['trial', formatNumber(s.stages.trial)],
        ['trialsEndingSoon', formatNumber(s.trialsEndingSoon)],
        ['past_due', formatNumber(s.stages.past_due)],
        ['newRequests', formatNumber(s.newRequests)],
      ]
    : [];
  return (
    <dl className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6" aria-busy={summary.isPending}>
      {cards.map(([key, value]) => (
        <div key={key} className="rounded-xl border bg-card p-4">
          <dt className="text-xs text-muted-foreground">{t(`saas.summary.${key}`)}</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SubscriptionsTable() {
  const { t } = useTranslation();
  const [stage, setStage] = useState<SaasStage>();
  const [offset, setOffset] = useState(0);
  const query = useSaasSubscriptions({ ...(stage ? { stage } : {}), offset });
  return (
    <section className="space-y-3">
      <div className="w-56">
        <Select
          value={stage ?? ALL}
          onValueChange={(v) => {
            setStage(v === ALL ? undefined : SaasStage.parse(v));
            setOffset(0);
          }}
        >
          <SelectTrigger aria-label={t('saas.filterStage')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('saas.allStages')}</SelectItem>
            {SaasStage.options.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`saas.stage.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {query.isPending && <p role="status">{t('saas.loading')}</p>}
      {query.isError && (
        <div role="alert" className="flex items-center gap-3">
          {t('saas.loadError')}
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t('saas.retry')}
          </Button>
        </div>
      )}
      {query.data?.data.length === 0 ? (
        <div className="rounded-xl border p-8 text-center">
          <Users className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p>{t('saas.emptyCustomers')}</p>
        </div>
      ) : query.data ? (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('saas.sub.customer')}</TableHead>
                <TableHead>{t('saas.sub.planName')}</TableHead>
                <TableHead>{t('saas.sub.stage')}</TableHead>
                <TableHead>{t('saas.sub.billingPeriod')}</TableHead>
                <TableHead className="text-right">{t('saas.sub.mrr')}</TableHead>
                <TableHead>{t('saas.sub.nextDate')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.data.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <Link
                      to="/app/contacts"
                      search={{ contact: s.contactId }}
                      className="font-medium hover:underline"
                    >
                      {s.contactName ?? t('saas.unnamed')}
                    </Link>
                  </TableCell>
                  <TableCell>{s.planName}</TableCell>
                  <TableCell>
                    <StageBadge stage={s.stage} />
                  </TableCell>
                  <TableCell>{t(`saas.period.${s.billingPeriod}`)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatVnd(s.mrr)}</TableCell>
                  <TableCell className="tabular-nums">
                    {(s.stage === 'trial'
                      ? s.trialEndsOn
                      : s.stage === 'canceled'
                        ? s.canceledOn
                        : s.renewsOn) ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={offset === 0 || query.isPending}
          onClick={() => setOffset(Math.max(0, offset - 100))}
        >
          {t('saas.previous')}
        </Button>
        <Button
          variant="outline"
          disabled={typeof query.data?.nextOffset !== 'number'}
          onClick={() => {
            if (typeof query.data?.nextOffset === 'number') setOffset(query.data.nextOffset);
          }}
        >
          {t('saas.next')}
        </Button>
      </div>
    </section>
  );
}
