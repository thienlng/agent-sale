import {
  PutSaasSubscription,
  SaasBillingPeriod,
  SaasStage,
  type SaasSubscriptionDto,
} from '@agent-sales/contracts';
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

import { usePutContactSubscription } from '../api/saas';

const DATES = ['trialEndsOn', 'startedOn', 'renewsOn', 'canceledOn'] as const;

/** Creates or edits a customer's subscription (`version` null creates it). */
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
    put = usePutContactSubscription(contactId);
  const [planName, setPlanName] = useState(current?.planName ?? ''),
    [stage, setStage] = useState<SaasStage>(current?.stage ?? 'trial'),
    [period, setPeriod] = useState<SaasBillingPeriod>(current?.billingPeriod ?? 'monthly'),
    [mrr, setMrr] = useState(String(current?.mrr ?? 0)),
    [seats, setSeats] = useState(current?.seats ? String(current.seats) : ''),
    [externalRef, setExternalRef] = useState(current?.externalRef ?? ''),
    [note, setNote] = useState(current?.note ?? ''),
    [dates, setDates] = useState<Record<(typeof DATES)[number], string>>({
      trialEndsOn: current?.trialEndsOn ?? '',
      startedOn: current?.startedOn ?? '',
      renewsOn: current?.renewsOn ?? '',
      canceledOn: current?.canceledOn ?? '',
    }),
    [invalid, setInvalid] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = PutSaasSubscription.safeParse({
      version: current?.version ?? null,
      planName,
      stage,
      billingPeriod: period,
      mrr: mrr.trim() ? Number(mrr) : Number.NaN,
      seats: seats.trim() ? Number(seats) : null,
      trialEndsOn: dates.trialEndsOn || null,
      startedOn: dates.startedOn || null,
      renewsOn: dates.renewsOn || null,
      canceledOn: dates.canceledOn || null,
      externalRef: externalRef.trim() || null,
      note,
    });
    if (!parsed.success) {
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
      <div className="grid gap-3 sm:grid-cols-2">
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
          <Input
            id="sub-mrr"
            type="number"
            min={0}
            step={1}
            value={mrr}
            onChange={(e) => setMrr(e.target.value)}
            required
          />
        </div>
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
        {DATES.map((key) => (
          <div className="space-y-2" key={key}>
            <Label htmlFor={`sub-${key}`}>{t(`saas.sub.${key}`)}</Label>
            <Input
              id={`sub-${key}`}
              type="date"
              value={dates[key]}
              onChange={(e) => setDates((d) => ({ ...d, [key]: e.target.value }))}
              required={
                (key === 'trialEndsOn' && stage === 'trial') ||
                (key === 'canceledOn' && stage === 'canceled')
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
      <div className="space-y-2">
        <Label htmlFor="sub-note">{t('saas.field.note')}</Label>
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
