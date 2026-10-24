import {
  ORDER_POLICY_FIELDS,
  type OrderPolicyField,
  OrderSource,
  type OrderSourcePolicy,
  defaultOrderPolicy,
} from '@agent-sales/contracts';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

import { settingsErrorMessage, useOrderSettings, useSaveOrderSettings } from '../api/commerce';
import { Chips } from './order-settings';

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

/**
 * Per-source order requirements (#17, #18): what an order from the selected source
 * needs to be saved, and what it needs before it is confirmed or shipped. Saving
 * changes only the selected source.
 */
export function OrderSourcePolicies() {
  const { t } = useTranslation();
  const settings = useOrderSettings();
  const save = useSaveOrderSettings();
  const [source, setSource] = useState<OrderSource>('hotline');
  const [create, setCreate] = useState<Set<OrderPolicyField>>(new Set());
  const [confirm, setConfirm] = useState<Set<OrderPolicyField>>(new Set());

  const stored = settings.data?.policies.find((p) => p.source === source);
  // Load the selected source's policy (again after a save or a reload).
  useEffect(() => {
    if (stored) {
      setCreate(new Set(stored.create));
      setConfirm(new Set(stored.confirm));
    }
  }, [stored]);

  const toggle = (set: Set<OrderPolicyField>, f: OrderPolicyField) => {
    const next = new Set(set);
    if (next.has(f)) next.delete(f);
    else next.add(f);
    return next;
  };

  if (!settings.data || !stored) return <Skeleton className="h-64 rounded-xl" />;
  const data = settings.data;
  const fallback = defaultOrderPolicy(source);
  const isDefault = same(stored.create, fallback.create) && same(stored.confirm, fallback.confirm);
  const dirty = !same([...create], stored.create) || !same([...confirm], stored.confirm);

  const submit = () => {
    const next: OrderSourcePolicy = { source, create: [...create], confirm: [...confirm] };
    save.mutate(
      { ...data, policies: data.policies.map((p) => (p.source === source ? next : p)) },
      {
        onSuccess: () => toast.success(t('orderSettings.saved')),
        onError: (err) => toast.error(settingsErrorMessage(t, err)),
      },
    );
  };

  return (
    <div className="flex flex-col gap-6 rounded-xl border bg-card p-4 md:p-6">
      <section className="flex flex-col gap-2">
        <Label htmlFor="osp-source">{t('orderSettings.policy.source')}</Label>
        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={source}
            onValueChange={(v) => setSource(v as OrderSource)}
            disabled={save.isPending}
          >
            <SelectTrigger id="osp-source" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OrderSource.options.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`source.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isDefault ? (
            <span className="text-sm text-muted-foreground">
              {t('orderSettings.policy.default')}
            </span>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">{t('orderSettings.policy.hint')}</p>
      </section>
      <section>
        <h2 className="font-semibold">{t('orderSettings.policy.create')}</h2>
        <p className="mt-1 mb-3 text-sm text-muted-foreground">
          {t('orderSettings.policy.createHint')}
        </p>
        <Chips
          label={t('orderSettings.policy.create')}
          prefix="orderSettings.policy.fields"
          options={ORDER_POLICY_FIELDS}
          selected={create}
          onToggle={(f) => setCreate(toggle(create, f))}
        />
      </section>
      <section>
        <h2 className="font-semibold">{t('orderSettings.policy.confirm')}</h2>
        <p className="mt-1 mb-3 text-sm text-muted-foreground">
          {t('orderSettings.policy.confirmHint')}
        </p>
        <Chips
          label={t('orderSettings.policy.confirm')}
          prefix="orderSettings.policy.fields"
          options={ORDER_POLICY_FIELDS}
          selected={confirm}
          onToggle={(f) => setConfirm(toggle(confirm, f))}
        />
      </section>
      <div>
        <Button disabled={save.isPending || !dirty} onClick={submit}>
          {t('orderSettings.save')}
        </Button>
      </div>
    </div>
  );
}
