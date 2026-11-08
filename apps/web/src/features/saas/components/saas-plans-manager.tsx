import { SaasBillingPeriod, type SaasPlanDto, SaasPlanPrices } from '@agent-sales/contracts';
import { Archive, ArchiveRestore, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/errors';
import { formatVnd } from '@/lib/format';
import { cn } from '@/lib/utils';

import { useSaasPlanMutations, useSaasPlans } from '../api/saas';
import { planMrr } from './subscription-form';

type PriceDraft = Record<SaasBillingPeriod, string>;
const PERIODS = SaasBillingPeriod.options;
const emptyPrices = (): PriceDraft => ({ monthly: '', quarterly: '', semiannual: '', yearly: '' });
const draftOf = (p: SaasPlanDto): PriceDraft =>
  Object.fromEntries(
    PERIODS.map((k) => [k, p.prices[k] === undefined ? '' : String(p.prices[k])]),
  ) as PriceDraft;
/** The prices typed in, or null when none or one is not a whole amount. */
function pricesOf(d: PriceDraft) {
  const raw = Object.fromEntries(
    PERIODS.filter((k) => d[k].trim() !== '').map((k) => [k, Number(d[k])]),
  );
  const parsed = SaasPlanPrices.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function PriceFields({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: PriceDraft;
  onChange: (next: PriceDraft) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-2 sm:grid-cols-4">
      {PERIODS.map((k) => (
        <div key={k} className="space-y-1">
          <Label htmlFor={`${idPrefix}-${k}`} className="text-xs">
            {t('saas.plans.price', { period: t(`saas.period.${k}`) })}
          </Label>
          <Input
            id={`${idPrefix}-${k}`}
            type="number"
            min={0}
            step={1}
            value={value[k]}
            onChange={(e) => onChange({ ...value, [k]: e.target.value })}
          />
        </div>
      ))}
    </div>
  );
}

function PlanRow({ plan }: { plan: SaasPlanDto }) {
  const { t } = useTranslation();
  const { update } = useSaasPlanMutations();
  const [name, setName] = useState(plan.name),
    [prices, setPrices] = useState(draftOf(plan));
  const fail = (err: unknown) => toast.error(errorMessage(t, err));
  const save = (body: { name?: string; prices?: SaasPlanPrices; archived?: boolean }) =>
    update.mutate(
      { id: plan.id, body: { ...body, expectedVersion: plan.version } },
      { onSuccess: () => toast.success(t('saas.plans.saved')), onError: fail },
    );
  const next = pricesOf(prices);
  const dirty = name.trim() !== plan.name || JSON.stringify(next) !== JSON.stringify(plan.prices);
  const monthly = PERIODS.map((k) => planMrr(plan, k)).find((v) => v !== null);
  return (
    <li className={cn('space-y-3 p-3', plan.archived && 'bg-muted/40')}>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={t('saas.plans.name')}
          className="min-w-40 flex-1"
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {monthly !== undefined ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {t('saas.plans.from', { mrr: formatVnd(monthly) })}
          </span>
        ) : null}
        {plan.archived ? (
          <span className="text-xs text-muted-foreground">{t('saas.plans.archived')}</span>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => save({ archived: !plan.archived })}
          aria-label={`${plan.name}: ${t(plan.archived ? 'saas.plans.restore' : 'saas.plans.archive')}`}
        >
          {plan.archived ? <ArchiveRestore /> : <Archive />}
          <span className="hidden sm:inline">
            {t(plan.archived ? 'saas.plans.restore' : 'saas.plans.archive')}
          </span>
        </Button>
      </div>
      <PriceFields idPrefix={`plan-${plan.id}`} value={prices} onChange={setPrices} />
      <Button
        size="sm"
        disabled={!dirty || !next || !name.trim() || update.isPending}
        onClick={() => next && save({ name: name.trim(), prices: next })}
      >
        {t('saas.plans.save')}
      </Button>
    </li>
  );
}

/**
 * The business's plan catalog (spec §6.1): a name and a price per billing period. A subscription
 * on a plan gets its MRR from it. Plans are archived, never deleted.
 */
export function SaasPlansManager() {
  const { t } = useTranslation();
  const plans = useSaasPlans();
  const { create } = useSaasPlanMutations();
  const [name, setName] = useState(''),
    [prices, setPrices] = useState(emptyPrices());
  const next = pricesOf(prices);
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !next) return;
    create.mutate(
      { name: name.trim(), prices: next, position: plans.data?.data.length ?? 0 },
      {
        onSuccess: () => {
          setName('');
          setPrices(emptyPrices());
          toast.success(t('saas.plans.saved'));
        },
        onError: (err) => toast.error(errorMessage(t, err)),
      },
    );
  };

  if (!plans.data) return <Skeleton className="h-64 rounded-xl" />;
  const list = plans.data.data;
  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 md:p-6">
      <p className="text-sm text-muted-foreground">{t('saas.plans.hint')}</p>
      {list.length ? (
        <ol className="divide-y rounded-lg border">
          {list.map((p) => (
            <PlanRow key={`${p.id}:${p.version}`} plan={p} />
          ))}
        </ol>
      ) : (
        <p className="text-sm">{t('saas.plans.none')}</p>
      )}
      <form onSubmit={add} className="space-y-3 rounded-lg border p-3">
        <div className="space-y-1">
          <Label htmlFor="new-plan-name">{t('saas.plans.newName')}</Label>
          <Input
            id="new-plan-name"
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="max-w-xs"
          />
        </div>
        <PriceFields idPrefix="new-plan" value={prices} onChange={setPrices} />
        <Button type="submit" disabled={!name.trim() || !next || create.isPending}>
          <Plus />
          {t('saas.plans.add')}
        </Button>
      </form>
    </div>
  );
}
