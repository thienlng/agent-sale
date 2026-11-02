import {
  PutSaasSubscription,
  SAAS_PERIOD_MONTHS,
  SaasBillingPeriod,
  SaasChurnReason,
  type SaasPlanDto,
  SaasStage,
  type SaasSubscriptionDto,
} from '@agent-sales/contracts';
import { Lock } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/errors';
import { formatVnd } from '@/lib/format';

import { usePutContactSubscription, useSaasPlans } from '../api/saas';

const DATES = ['trialEndsOn', 'startedOn', 'renewsOn', 'canceledOn'] as const;
/** No catalog plan: the name and MRR are typed in. */
const CUSTOM = '__custom';

/** MRR of a catalog plan for a period (the server computes the same), null without a price. */
export function planMrr(plan: Pick<SaasPlanDto, 'prices'>, period: SaasBillingPeriod) {
  const price = plan.prices[period];
  return price === undefined ? null : Math.round(price / SAAS_PERIOD_MONTHS[period]);
}

/**
 * Creates or edits a customer's subscription (`version` null creates it). A catalog plan names the
 * plan and computes the MRR; a cancellation asks why. A row synced from Rapiz (`linked`) shows its
 * plan, stage, period, MRR and dates read-only; seats, note and the churn reason stay editable.
 */
export function SubscriptionForm({
  contactId,
  current,
  onSaved,
  onCancel,
}: {
  contactId: string;
  current: SaasSubscriptionDto | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation(),
    put = usePutContactSubscription(contactId),
    plans = useSaasPlans().data?.data ?? [];
  const linked = Boolean(current?.linked);
  const [planId, setPlanId] = useState(current?.planId ?? CUSTOM),
    [planName, setPlanName] = useState(current?.planName ?? ''),
    [stage, setStage] = useState<SaasStage>(current?.stage ?? 'trial'),
    [period, setPeriod] = useState<SaasBillingPeriod>(current?.billingPeriod ?? 'monthly'),
    [mrr, setMrr] = useState(String(current?.mrr ?? 0)),
    [seats, setSeats] = useState(current?.seats ? String(current.seats) : ''),
    [externalRef, setExternalRef] = useState(current?.externalRef ?? ''),
    [note, setNote] = useState(current?.note ?? ''),
    [churnReason, setChurnReason] = useState<SaasChurnReason | ''>(current?.churnReason ?? ''),
    [churnNote, setChurnNote] = useState(current?.churnNote ?? ''),
    [dates, setDates] = useState<Record<(typeof DATES)[number], string>>({
      trialEndsOn: current?.trialEndsOn ?? '',
      startedOn: current?.startedOn ?? '',
      renewsOn: current?.renewsOn ?? '',
      canceledOn: current?.canceledOn ?? '',
    }),
    [invalid, setInvalid] = useState(false);
  // Archived plans stay selectable only for the subscription already on them.
  const choices = plans.filter((p) => !p.archived || p.id === current?.planId);
  const plan = planId === CUSTOM ? null : (plans.find((p) => p.id === planId) ?? null);
  const computed = plan ? planMrr(plan, period) : null;
  const canceled = stage === 'canceled';

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = PutSaasSubscription.safeParse({
      version: current?.version ?? null,
      planId: plan?.id ?? null,
      planName: plan?.name ?? planName,
      stage,
      billingPeriod: period,
      mrr: plan ? (computed ?? Number.NaN) : mrr.trim() ? Number(mrr) : Number.NaN,
      seats: seats.trim() ? Number(seats) : null,
      trialEndsOn: dates.trialEndsOn || null,
      startedOn: dates.startedOn || null,
      renewsOn: dates.renewsOn || null,
      canceledOn: dates.canceledOn || null,
      externalRef: externalRef.trim() || null,
      note,
      churnReason: canceled ? churnReason || null : null,
      churnNote: canceled ? churnNote : '',
    });
    // A staff cancellation needs its reason (a synced one may arrive without it).
    if (!parsed.success || (canceled && !linked && !churnReason)) {
      setInvalid(true);
      return;
    }
    put.mutate(parsed.data, {
      onSuccess: () => {
        toast.success(t('saas.subscriptionSaved'));
        onSaved();
      },
      onError: (err) => toast.error(errorMessage(t, err)),
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {linked ? (
        <p id="sub-linked-hint" className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock aria-hidden className="size-3.5 shrink-0" />
          {t('saas.sub.linkedHint')}
        </p>
      ) : null}
      <fieldset disabled={linked} aria-describedby={linked ? 'sub-linked-hint' : undefined}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="sub-plan-id">{t('saas.sub.catalogPlan')}</Label>
            <Select value={planId} onValueChange={setPlanId}>
              <SelectTrigger id="sub-plan-id">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CUSTOM}>{t('saas.sub.customPlan')}</SelectItem>
                {choices.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {plan ? null : (
            <div className="space-y-2">
              <Label htmlFor="sub-plan">{t('saas.sub.planName')}</Label>
              <Input
                id="sub-plan"
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
                maxLength={120}
                required
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="sub-stage">{t('saas.sub.stage')}</Label>
            <Select value={stage} onValueChange={(v) => setStage(SaasStage.parse(v))}>
              <SelectTrigger id="sub-stage">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SaasStage.options.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`saas.stage.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sub-period">{t('saas.sub.billingPeriod')}</Label>
            <Select value={period} onValueChange={(v) => setPeriod(SaasBillingPeriod.parse(v))}>
              <SelectTrigger id="sub-period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SaasBillingPeriod.options.map((p) => (
                  <SelectItem key={p} value={p}>
                    {t(`saas.period.${p}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sub-mrr">{t('saas.sub.mrr')}</Label>
            {plan ? (
              <p id="sub-mrr" className="flex h-9 items-center text-sm tabular-nums">
                {computed === null ? (
                  <span className="text-destructive">{t('saas.sub.noPrice')}</span>
                ) : (
                  formatVnd(computed)
                )}
              </p>
            ) : (
              <Input
                id="sub-mrr"
                type="number"
                min={0}
                step={1}
                value={mrr}
                onChange={(e) => setMrr(e.target.value)}
                required
              />
            )}
          </div>
          {DATES.map((key) => (
            <div className="space-y-2" key={key}>
              <Label htmlFor={`sub-${key}`}>{t(`saas.sub.${key}`)}</Label>
              <Input
                id={`sub-${key}`}
                type="date"
                value={dates[key]}
                onChange={(e) => setDates((d) => ({ ...d, [key]: e.target.value }))}
                required={
                  (key === 'trialEndsOn' && stage === 'trial') || (key === 'canceledOn' && canceled)
                }
              />
            </div>
          ))}
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="sub-ref">{t('saas.sub.externalRef')}</Label>
            <Input
              id="sub-ref"
              value={externalRef}
              onChange={(e) => setExternalRef(e.target.value)}
              maxLength={200}
            />
          </div>
        </div>
      </fieldset>
      <div className="space-y-2">
        <Label htmlFor="sub-seats">{t('saas.sub.seats')}</Label>
        <Input
          id="sub-seats"
          type="number"
          min={1}
          step={1}
          value={seats}
          onChange={(e) => setSeats(e.target.value)}
        />
      </div>
      {canceled ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="sub-churn">{t('saas.sub.churnReason')}</Label>
            <Select
              value={churnReason}
              onValueChange={(v) => setChurnReason(SaasChurnReason.parse(v))}
            >
              <SelectTrigger id="sub-churn" aria-required={!linked}>
                <SelectValue placeholder={t('saas.sub.churnReasonPick')} />
              </SelectTrigger>
              <SelectContent>
                {SaasChurnReason.options.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(`saas.churn.${r}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sub-churn-note">{t('saas.sub.churnNote')}</Label>
            <Input
              id="sub-churn-note"
              value={churnNote}
              onChange={(e) => setChurnNote(e.target.value)}
              maxLength={1000}
            />
          </div>
        </div>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="sub-note">{t('saas.sub.note')}</Label>
        <Textarea
          id="sub-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={2000}
        />
      </div>
      {invalid && (
        <p role="alert" className="text-sm text-destructive">
          {t('saas.subscriptionInvalid')}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={put.isPending}>
          {t('saas.saveSubscription')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('saas.cancel')}
        </Button>
      </div>
    </form>
  );
}
