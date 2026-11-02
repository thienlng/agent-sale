import { type BillingSettingsDto, PutBillingSettingsRequest } from '@agent-sales/contracts';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';

import { useAdminPlans, useBillingSettings, useSaveBillingSettings } from '../../api/backoffice';
import { VN_BANKS } from '../../lib/banks';
import { toastAdminError, validReason } from '../../lib/mutation-error';
import { PageHeader } from './page-header';
import { ReasonField } from './reason-field';

const NONE = '__none';

interface Draft {
  trialEnabled: boolean;
  trialPlanCode: string | null;
  trialDays: string;
  afterTrialPlanCode: string;
  graceDays: string;
  suspendDays: string;
  bankBin: string | null;
  bankAccountNo: string;
  bankAccountName: string;
}

function draftOf(s: BillingSettingsDto): Draft {
  return {
    trialEnabled: s.trialEnabled,
    trialPlanCode: s.trialPlanCode,
    trialDays: s.trialDays?.toString() ?? '',
    afterTrialPlanCode: s.afterTrialPlanCode,
    graceDays: String(s.graceDays),
    suspendDays: String(s.suspendDays),
    bankBin: s.bankBin,
    bankAccountNo: s.bankAccountNo ?? '',
    bankAccountName: s.bankAccountName ?? '',
  };
}

const int = (s: string) => (s.trim() === '' ? Number.NaN : Number(s));

/** Signup trial, lifecycle, VietQR bank account and HQ sync scope (one row, optimistic version). */
export function SettingsPage() {
  const { t } = useTranslation('backoffice');
  const settings = useBillingSettings();
  const plans = useAdminPlans();
  const save = useSaveBillingSettings();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);

  // Re-seed the form whenever the server copy changes (first load, save, or a 409 refetch).
  useEffect(() => {
    if (settings.data) setDraft(draftOf(settings.data));
  }, [settings.data]);

  if (!settings.data || !draft) {
    return (
      <div className="flex w-full flex-col gap-8">
        <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
        {settings.isError ? (
          <p className="text-sm text-destructive">{t('common.loadError')}</p>
        ) : (
          <Skeleton className="h-96 w-full" />
        )}
      </div>
    );
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });
  // Latest version per code, sellable only.
  const sellable = [
    ...new Map(
      (plans.data ?? [])
        .filter((p) => !p.archived)
        .sort((a, b) => a.version - b.version)
        .map((p) => [p.code, p]),
    ).values(),
  ].sort((a, b) => a.sortOrder - b.sortOrder);
  const trialPlans = sellable.filter((p) => p.isPublic);

  const request = {
    trialEnabled: draft.trialEnabled,
    trialPlanCode: draft.trialPlanCode,
    trialDays: draft.trialDays.trim() === '' ? null : int(draft.trialDays),
    afterTrialPlanCode: draft.afterTrialPlanCode,
    hqContactScope: 'owner' as const,
    graceDays: int(draft.graceDays),
    suspendDays: int(draft.suspendDays),
    bankBin: draft.bankBin,
    bankAccountNo: draft.bankAccountNo.trim() || null,
    bankAccountName: draft.bankAccountName.trim() || null,
    expectedVersion: settings.data.version,
    reason,
  };
  const parsed = PutBillingSettingsRequest.safeParse(request);
  const bad = new Set(parsed.success ? [] : parsed.error.issues.map((i) => String(i.path[0])));
  const show = (f: string) => submitted && bad.has(f);

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (!parsed.success) return;
    save.mutate(parsed.data, {
      onSuccess: () => {
        toast.success(t('common.saved'));
        setReason('');
        setSubmitted(false);
      },
      onError: (err) => toastAdminError(t, err),
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex w-full max-w-3xl flex-col gap-8">
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.trial')}</CardTitle>
          <CardDescription>{t('settings.trialEnabledHint')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <label className="flex items-center justify-between gap-3 text-sm font-medium">
            {t('settings.trialEnabled')}
            <Switch
              checked={draft.trialEnabled}
              onCheckedChange={(v) => set('trialEnabled', v)}
              aria-label={t('settings.trialEnabled')}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="s-trial-plan">{t('settings.trialPlan')}</Label>
              <Select
                value={draft.trialPlanCode ?? NONE}
                onValueChange={(v) => set('trialPlanCode', v === NONE ? null : v)}
              >
                <SelectTrigger
                  id="s-trial-plan"
                  className="w-full"
                  aria-invalid={show('trialPlanCode')}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('common.none')}</SelectItem>
                  {trialPlans.map((p) => (
                    <SelectItem key={p.code} value={p.code}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="s-trial-days">{t('settings.trialDays')}</Label>
              <Input
                id="s-trial-days"
                inputMode="numeric"
                value={draft.trialDays}
                aria-invalid={show('trialDays')}
                onChange={(e) => set('trialDays', e.target.value.trim())}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="s-after-plan">{t('settings.afterTrialPlan')}</Label>
              <Select
                value={draft.afterTrialPlanCode}
                onValueChange={(v) => set('afterTrialPlanCode', v)}
              >
                <SelectTrigger id="s-after-plan" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sellable.map((p) => (
                    <SelectItem key={p.code} value={p.code}>
                      {p.name}
                    </SelectItem>
                  ))}
                  {sellable.some((p) => p.code === draft.afterTrialPlanCode) ? null : (
                    <SelectItem value={draft.afterTrialPlanCode}>
                      {draft.afterTrialPlanCode}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          {show('trialPlanCode') ? (
            <p className="text-sm text-destructive">{t('settings.needTrialPlan')}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.lifecycle')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="s-grace">{t('settings.graceDays')}</Label>
            <Input
              id="s-grace"
              inputMode="numeric"
              value={draft.graceDays}
              aria-invalid={show('graceDays')}
              onChange={(e) => set('graceDays', e.target.value.trim())}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="s-suspend">{t('settings.suspendDays')}</Label>
            <Input
              id="s-suspend"
              inputMode="numeric"
              value={draft.suspendDays}
              aria-invalid={show('suspendDays')}
              onChange={(e) => set('suspendDays', e.target.value.trim())}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.bank')}</CardTitle>
          <CardDescription>{t('settings.bankHint')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="s-bank">{t('settings.bankName')}</Label>
            <Select
              value={draft.bankBin ?? NONE}
              onValueChange={(v) => set('bankBin', v === NONE ? null : v)}
            >
              <SelectTrigger id="s-bank" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('settings.bankNone')}</SelectItem>
                {VN_BANKS.map((b) => (
                  <SelectItem key={b.bin} value={b.bin}>
                    {b.name}
                  </SelectItem>
                ))}
                {draft.bankBin && !VN_BANKS.some((b) => b.bin === draft.bankBin) ? (
                  <SelectItem value={draft.bankBin}>{draft.bankBin}</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="s-bank-no">{t('settings.bankAccountNo')}</Label>
            <Input
              id="s-bank-no"
              value={draft.bankAccountNo}
              className="font-mono"
              aria-invalid={show('bankAccountNo')}
              onChange={(e) => set('bankAccountNo', e.target.value.trim())}
            />
            {show('bankAccountNo') ? (
              <p className="text-sm text-destructive">{t('settings.invalidAccountNo')}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="s-bank-name">{t('settings.bankAccountName')}</Label>
            <Input
              id="s-bank-name"
              value={draft.bankAccountName}
              maxLength={100}
              onChange={(e) => set('bankAccountName', e.target.value.toUpperCase())}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.hq')}</CardTitle>
        </CardHeader>
        <CardContent>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-medium">{t('settings.hqScope')}</legend>
            <RadioGroup value="owner">
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="owner" /> {t('settings.hqOwner')}
              </label>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <RadioGroupItem value="owner_and_billing" disabled />
                {t('settings.hqOwnerAndBilling')}
              </label>
            </RadioGroup>
          </fieldset>
        </CardContent>
      </Card>

      <ReasonField id="settings-reason" value={reason} onChange={setReason} />
      <div>
        <Button type="submit" disabled={save.isPending || !validReason(reason)}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}
