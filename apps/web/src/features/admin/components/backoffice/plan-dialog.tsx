import {
  type AdminPlanDto,
  BILLING_PERIODS,
  CreatePlanRequest,
  PublishPlanVersionRequest,
} from '@agent-sales/contracts';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

import { useSavePlan } from '../../api/backoffice';
import {
  completeEntitlements,
  ENTITLEMENT_ENTRIES,
  invalidEntitlementKeys,
} from '../../lib/entitlements';
import { toastAdminError, validReason } from '../../lib/mutation-error';
import { EntitlementField } from './entitlement-field';
import { ReasonField } from './reason-field';

const CODE = /^[a-z][a-z0-9_]{1,39}$/;
type Prices = Record<'1' | '3' | '6' | '12', string>;

function pricesOf(plan: AdminPlanDto | null): Prices {
  const p = plan?.priceByPeriod ?? {};
  return {
    '1': p['1']?.toString() ?? '',
    '3': p['3']?.toString() ?? '',
    '6': p['6']?.toString() ?? '',
    '12': p['12']?.toString() ?? '',
  };
}

/**
 * Create a plan (`plan` = null) or publish the next version of one. The entitlement form is
 * generated from `ENTITLEMENT_KEYS`; the request is validated with the contract schema itself.
 */
export function PlanDialog({
  open,
  plan,
  onOpenChange,
}: {
  open: boolean;
  plan: AdminPlanDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('backoffice');
  const save = useSavePlan();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [sortOrder, setSortOrder] = useState('0');
  const [prices, setPrices] = useState<Prices>(pricesOf(null));
  const [entitlements, setEntitlements] = useState<Record<string, unknown>>(completeEntitlements());
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCode(plan?.code ?? '');
    setName(plan?.name ?? '');
    setDescription(plan?.description ?? '');
    setIsPublic(plan?.isPublic ?? true);
    setSortOrder(String(plan?.sortOrder ?? 0));
    setPrices(pricesOf(plan));
    setEntitlements(completeEntitlements(plan?.entitlements));
    setReason('');
    setSubmitted(false);
  }, [open, plan]);

  const body = {
    name,
    description,
    isPublic,
    sortOrder: Number(sortOrder),
    priceByPeriod: Object.fromEntries(
      Object.entries(prices)
        .filter(([, v]) => v.trim() !== '')
        .map(([k, v]) => [k, Number(v)]),
    ),
    entitlements,
    reason,
  };
  const parsed = plan
    ? PublishPlanVersionRequest.safeParse({ ...body, expectedVersion: plan.version })
    : CreatePlanRequest.safeParse({ ...body, code });
  const invalidKeys = useMemo(() => invalidEntitlementKeys(entitlements), [entitlements]);
  const issues = new Set(parsed.success ? [] : parsed.error.issues.map((i) => String(i.path[0])));
  const show = (field: string) => submitted && issues.has(field);

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (!parsed.success) return;
    const done = {
      onSuccess: () => {
        toast.success(t(plan ? 'plans.published' : 'plans.created'));
        onOpenChange(false);
      },
      onError: (err: Error) => toastAdminError(t, err),
    };
    if (plan)
      save.mutate({ code: plan.code, publish: parsed.data as PublishPlanVersionRequest }, done);
    else save.mutate({ create: parsed.data as CreatePlanRequest }, done);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} noValidate className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>{plan ? `${plan.name} · v${plan.version}` : t('plans.add')}</DialogTitle>
            {plan ? (
              <DialogDescription>
                {t('plans.publishNote', { count: plan.subscriberCount, version: plan.version })}
              </DialogDescription>
            ) : null}
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="plan-name">{t('plans.name')}</Label>
              <Input
                id="plan-name"
                value={name}
                maxLength={80}
                aria-invalid={show('name')}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="plan-code">{t('plans.code')}</Label>
              <Input
                id="plan-code"
                value={code}
                disabled={Boolean(plan)}
                className="font-mono"
                aria-invalid={!plan && submitted && !CODE.test(code)}
                aria-describedby="plan-code-hint"
                onChange={(e) => setCode(e.target.value.trim())}
              />
              <p
                id="plan-code-hint"
                className={
                  !plan && submitted && !CODE.test(code)
                    ? 'text-sm text-destructive'
                    : 'text-sm text-muted-foreground'
                }
              >
                {!plan && submitted && !CODE.test(code)
                  ? t('plans.invalidCode')
                  : t('plans.codeHint')}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="plan-description">{t('plans.description')}</Label>
            <Textarea
              id="plan-description"
              rows={2}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
              {t('plans.isPublic')}
              <Switch checked={isPublic} onCheckedChange={setIsPublic} />
            </label>
            <div className="flex flex-col gap-2">
              <Label htmlFor="plan-sort">{t('plans.sortOrder')}</Label>
              <Input
                id="plan-sort"
                inputMode="numeric"
                value={sortOrder}
                aria-invalid={show('sortOrder')}
                onChange={(e) => setSortOrder(e.target.value)}
              />
            </div>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">{t('plans.prices')}</legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {BILLING_PERIODS.map((p) => (
                <div key={p} className="flex flex-col gap-1">
                  <Label htmlFor={`plan-price-${p}`} className="text-xs text-muted-foreground">
                    {t('common.months', { count: p })}
                  </Label>
                  <Input
                    id={`plan-price-${p}`}
                    inputMode="numeric"
                    value={prices[String(p) as keyof Prices]}
                    aria-invalid={show('priceByPeriod')}
                    onChange={(e) => setPrices({ ...prices, [String(p)]: e.target.value.trim() })}
                  />
                </div>
              ))}
            </div>
            <p
              className={
                show('priceByPeriod') ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'
              }
            >
              {show('priceByPeriod') ? t('plans.invalidNumber') : t('plans.priceHint')}
            </p>
          </fieldset>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-medium">{t('plans.entitlementsTitle')}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {ENTITLEMENT_ENTRIES.map(([key, kind]) => (
                <EntitlementField
                  key={key}
                  id={`plan-ent-${key.replaceAll('.', '-')}`}
                  entitlementKey={key}
                  kind={kind}
                  value={entitlements[key]}
                  invalid={submitted && invalidKeys.has(key)}
                  onChange={(v) => setEntitlements((cur) => ({ ...cur, [key]: v }))}
                />
              ))}
            </div>
          </fieldset>

          <ReasonField id="plan-reason" value={reason} onChange={setReason} />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending || !validReason(reason)}>
              {plan ? t('plans.publish', { version: plan.version + 1 }) : t('plans.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
