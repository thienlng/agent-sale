import {
  type AdminAccountDetail,
  type AdminOverrideDto,
  BILLING_PERIODS,
  type EntitlementKey,
  ENTITLEMENT_KEYS,
  ExtendTrialRequest,
  PlanEntitlements,
  PutOverrideRequest,
  SetAccountPlanRequest,
} from '@agent-sales/contracts';
import type { TFunction } from 'i18next';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { isoDate } from '@/lib/format';

import {
  useAdminPlans,
  useExtendTrial,
  usePutOverride,
  useSetAccountPlan,
} from '../../api/backoffice';
import { emptyValue, ENTITLEMENT_ENTRIES } from '../../lib/entitlements';
import { toastAdminError, validReason } from '../../lib/mutation-error';
import { EntitlementField } from './entitlement-field';
import { ReasonField } from './reason-field';

const NONE = '__none';

/** Start of a local calendar day (the operator's browser, Asia/Ho_Chi_Minh in practice). */
const startOfDay = (day: string) => new Date(`${day}T00:00:00`).toISOString();
const endOfDay = (day: string) => new Date(`${day}T23:59:59`).toISOString();

function done(t: TFunction<'backoffice'>, close: () => void) {
  return {
    onSuccess: () => {
      toast.success(t('common.saved'));
      close();
    },
    onError: (err: Error) => toastAdminError(t as TFunction, err),
  };
}

/** Set plan, period, start and status (the CLI's job, now audited in the admin). */
export function ChangePlanDialog({
  account,
  open,
  onOpenChange,
}: {
  account: AdminAccountDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('backoffice');
  const plans = useAdminPlans();
  const setPlan = useSetAccountPlan(account.id);
  const [planCode, setPlanCode] = useState('');
  const [period, setPeriod] = useState<string>(NONE);
  const [startsOn, setStartsOn] = useState('');
  const [status, setStatus] = useState<'active' | 'trialing'>('active');
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPlanCode(account.subscription?.plan.code ?? '');
    setPeriod(account.subscription?.periodMonths?.toString() ?? NONE);
    setStartsOn('');
    setStatus('active');
    setReason('');
    setSubmitted(false);
  }, [open, account]);

  const choices = [
    ...new Map(
      (plans.data ?? [])
        .filter((p) => !p.archived || p.code === account.subscription?.plan.code)
        .sort((a, b) => a.version - b.version)
        .map((p) => [p.code, p]),
    ).values(),
  ].sort((a, b) => a.sortOrder - b.sortOrder);
  const plan = choices.find((p) => p.code === planCode);
  const priced = plan ? Object.keys(plan.priceByPeriod).length > 0 : false;
  const needPeriod = priced && period === NONE;
  const parsed = SetAccountPlanRequest.safeParse({
    planCode,
    periodMonths: period === NONE ? null : Number(period),
    ...(startsOn ? { startsAt: startOfDay(startsOn) } : {}),
    status,
    expectedVersion: account.subscription?.version ?? null,
    reason,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (!parsed.success || needPeriod) return;
    setPlan.mutate(
      parsed.data,
      done(t, () => onOpenChange(false)),
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{t('account.planDialog.title', { name: account.name })}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="cp-plan">{t('account.planDialog.plan')}</Label>
              <Select value={planCode} onValueChange={setPlanCode}>
                <SelectTrigger id="cp-plan" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {choices.map((p) => (
                    <SelectItem key={p.code} value={p.code}>
                      {p.name} · v{p.version}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cp-period">{t('account.planDialog.period')}</Label>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger
                  id="cp-period"
                  className="w-full"
                  aria-invalid={submitted && needPeriod}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('account.planDialog.periodNone')}</SelectItem>
                  {BILLING_PERIODS.map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {t('common.months', { count: m })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {submitted && needPeriod ? (
                <p className="text-sm text-destructive">{t('account.planDialog.needPeriod')}</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cp-start">{t('account.planDialog.startsAt')}</Label>
              <Input
                id="cp-start"
                type="date"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
              />
              <p className="text-sm text-muted-foreground">
                {t('account.planDialog.startsAtHint')}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cp-status">{t('account.planDialog.status')}</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as 'active' | 'trialing')}>
                <SelectTrigger id="cp-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t('subStatus.active')}</SelectItem>
                  <SelectItem value="trialing">{t('subStatus.trialing')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <ReasonField id="cp-reason" value={reason} onChange={setReason} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={setPlan.isPending || !planCode || !validReason(reason)}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Push a trial's end date out (only for a trialing subscription). */
export function ExtendTrialDialog({
  account,
  open,
  onOpenChange,
}: {
  account: AdminAccountDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('backoffice');
  const extend = useExtendTrial(account.id);
  const [day, setDay] = useState('');
  const [reason, setReason] = useState('');
  const currentEnd = account.subscription?.periodEnd ?? null;

  useEffect(() => {
    if (open) {
      setDay('');
      setReason('');
    }
  }, [open]);

  const tooEarly =
    Boolean(day) && currentEnd !== null && new Date(endOfDay(day)) <= new Date(currentEnd);
  const parsed = ExtendTrialRequest.safeParse({
    until: day ? endOfDay(day) : '',
    expectedVersion: account.subscription?.version,
    reason,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!parsed.success || tooEarly) return;
    extend.mutate(
      parsed.data,
      done(t, () => onOpenChange(false)),
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{t('account.trialDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="tr-until">{t('account.trialDialog.until')}</Label>
            <Input
              id="tr-until"
              type="date"
              value={day}
              min={currentEnd ? isoDate(new Date(currentEnd)) : undefined}
              aria-invalid={tooEarly}
              onChange={(e) => setDay(e.target.value)}
            />
            {tooEarly ? (
              <p className="text-sm text-destructive">{t('account.trialDialog.mustBeLater')}</p>
            ) : null}
          </div>
          <ReasonField id="tr-reason" value={reason} onChange={setReason} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={extend.isPending || !parsed.success || tooEarly}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Add or edit one account override; the value editor follows the entitlement's kind. */
export function OverrideDialog({
  accountId,
  override,
  open,
  onOpenChange,
}: {
  accountId: string;
  /** `null` = add a new one. */
  override: AdminOverrideDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('backoffice');
  const put = usePutOverride(accountId);
  const [key, setKey] = useState<EntitlementKey>('members.max');
  const [value, setValue] = useState<unknown>(emptyValue('limit'));
  const [expiresOn, setExpiresOn] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) return;
    const k = (override?.key ?? 'members.max') as EntitlementKey;
    setKey(k);
    setValue(override ? override.value : emptyValue(ENTITLEMENT_KEYS[k]));
    setExpiresOn(override?.expiresAt ? isoDate(new Date(override.expiresAt)) : '');
    setReason('');
  }, [open, override]);

  const kind = ENTITLEMENT_KEYS[key];
  const valueOk = PlanEntitlements.shape[key].safeParse(value).success;
  const parsed = PutOverrideRequest.safeParse({
    value,
    expiresAt: expiresOn ? endOfDay(expiresOn) : null,
    reason,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!parsed.success || !valueOk) return;
    put.mutate(
      { key, body: parsed.data },
      done(t, () => onOpenChange(false)),
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{t('account.overrideDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ov-key">{t('account.overrideDialog.key')}</Label>
            <Select
              value={key}
              disabled={override !== null}
              onValueChange={(v) => {
                const k = v as EntitlementKey;
                setKey(k);
                setValue(emptyValue(ENTITLEMENT_KEYS[k]));
              }}
            >
              <SelectTrigger id="ov-key" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENTITLEMENT_ENTRIES.map(([k]) => (
                  <SelectItem key={k} value={k}>
                    {t(`entitlements.${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <EntitlementField
            id="ov-value"
            entitlementKey={key}
            kind={kind}
            value={value}
            invalid={!valueOk}
            onChange={setValue}
          />
          <div className="flex flex-col gap-2">
            <Label htmlFor="ov-expires">{t('account.overrideDialog.expiresAt')}</Label>
            <Input
              id="ov-expires"
              type="date"
              value={expiresOn}
              onChange={(e) => setExpiresOn(e.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              {t('account.overrideDialog.expiresAtHint')}
            </p>
          </div>
          <ReasonField id="ov-reason" value={reason} onChange={setReason} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={put.isPending || !parsed.success || !valueOk}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
