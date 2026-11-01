import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

import type { SettingsDraft } from '../utils/settings-draft';

type Update = (change: (draft: SettingsDraft) => SettingsDraft) => void;

const MAX_FEE = 100_000_000;
const group = (n: number) => new Intl.NumberFormat('vi-VN').format(n);
const show = (fee: number | null) => (fee === null ? '' : group(fee));
const parse = (text: string) => (text ? Number(text.replace(/\D/g, '')) : null);

/**
 * Integer VND input where empty is a real value: null ("shop báo sau"), while
 * "0" stays free shipping. Shows vi-VN grouping and a numeric phone keyboard.
 */
function NullableMoneyInput({
  id,
  value,
  onValueChange,
  describedBy,
  suffix,
}: {
  id: string;
  value: number | null;
  onValueChange: (value: number | null) => void;
  describedBy: string;
  suffix: string;
}) {
  const [text, setText] = useState(show(value));
  useEffect(() => {
    setText((current) => (parse(current) === value ? current : show(value)));
  }, [value]);
  return (
    <div className="relative sm:w-56">
      <Input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        aria-describedby={describedBy}
        className="h-10 pr-8 text-right tabular-nums"
        value={text}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 9);
          const fee = digits ? Math.min(Number(digits), MAX_FEE) : null;
          setText(show(fee));
          onValueChange(fee);
        }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground"
      >
        {suffix}
      </span>
    </div>
  );
}

/**
 * "Chốt đơn": whether the bot takes orders in chat, and the shipping fee its
 * order summary quotes (empty means the shop confirms the fee later).
 */
export function BotSettingsOrders({ draft, update }: { draft: SettingsDraft; update: Update }) {
  const { t } = useTranslation();
  const set = <K extends 'orderTaking' | 'orderShippingFeeVnd'>(
    key: K,
    value: SettingsDraft['settings'][K],
  ) => update((d) => ({ ...d, settings: { ...d.settings, [key]: value } }));

  return (
    <section className="flex flex-col gap-5" aria-labelledby="settings-orders-title">
      <h2 id="settings-orders-title" className="text-base font-semibold">
        {t('settings.orders.title')}
      </h2>
      <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
        <div className="space-y-1">
          <Label htmlFor="setting-orderTaking">{t('settings.orders.enabled')}</Label>
          <p id="setting-orderTaking-hint" className="text-sm text-muted-foreground">
            {t('settings.orders.enabledHint')}
          </p>
        </div>
        <Switch
          id="setting-orderTaking"
          aria-describedby="setting-orderTaking-hint"
          checked={draft.settings.orderTaking}
          onCheckedChange={(value) => set('orderTaking', value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="setting-orderShippingFeeVnd">{t('settings.orders.shippingFee')}</Label>
        <NullableMoneyInput
          id="setting-orderShippingFeeVnd"
          describedBy="setting-orderShippingFeeVnd-hint"
          suffix={t('settings.orders.currency')}
          value={draft.settings.orderShippingFeeVnd}
          onValueChange={(fee) => set('orderShippingFeeVnd', fee)}
        />
        <p id="setting-orderShippingFeeVnd-hint" className="text-sm text-muted-foreground">
          {t('settings.orders.shippingFeeHint')}
        </p>
      </div>
    </section>
  );
}
