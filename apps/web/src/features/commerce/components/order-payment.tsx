import type { Amounts } from '@agent-sales/shared';
import { useTranslation } from 'react-i18next';

import { MoneyInput } from '@/components/money-input';
import { Checkbox } from '@/components/ui/checkbox';
import { formatVnd } from '@/lib/format';
import { cn } from '@/lib/utils';

import { Field, Panel } from './order-form-parts';

export interface PaymentState {
  discountType: 'amount' | 'percent';
  discountValue: number;
  shippingFeeCharged: number;
  freeShipping: boolean;
  surcharge: number;
  transferAmount: number;
}

/** Payment inputs and the live totals (same formulas as the server). */
export function PaymentPanel({
  value,
  onChange,
  amounts,
}: {
  value: PaymentState;
  onChange: (next: PaymentState) => void;
  amounts: Amounts;
}) {
  const { t } = useTranslation();
  const set = (patch: Partial<PaymentState>) => onChange({ ...value, ...patch });
  return (
    <Panel title={t('orderForm.payment')}>
      <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={value.freeShipping}
              onCheckedChange={(c) => set({ freeShipping: c === true })}
            />
            {t('orderForm.freeShipping')}
          </label>
          <Field id="of-ship" label={t('orderForm.shippingCharged')}>
            <MoneyInput
              id="of-ship"
              value={value.freeShipping ? 0 : value.shippingFeeCharged}
              disabled={value.freeShipping}
              onValueChange={(v) => set({ shippingFeeCharged: v })}
            />
          </Field>
          <Field id="of-discount" label={t('orderForm.discount')}>
            <div className="flex gap-2">
              <MoneyInput
                id="of-discount"
                value={value.discountValue}
                {...(value.discountType === 'percent' ? { max: 100 } : {})}
                onValueChange={(v) => set({ discountValue: v })}
              />
              <div
                className="flex shrink-0 rounded-lg border p-0.5"
                role="group"
                aria-label={t('orderForm.discount')}
              >
                {(['amount', 'percent'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={value.discountType === k}
                    onClick={() => set({ discountType: k, discountValue: 0 })}
                    className={cn(
                      'rounded-md px-2.5 text-sm',
                      value.discountType === k
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {k === 'amount'
                      ? t('orderForm.discountAmount')
                      : t('orderForm.discountPercent')}
                  </button>
                ))}
              </div>
            </div>
          </Field>
          <Field id="of-transfer" label={t('orderForm.transfer')}>
            <MoneyInput
              id="of-transfer"
              value={value.transferAmount}
              onValueChange={(v) => set({ transferAmount: v })}
            />
          </Field>
          <Field id="of-surcharge" label={t('orderForm.surcharge')}>
            <MoneyInput
              id="of-surcharge"
              value={value.surcharge}
              onValueChange={(v) => set({ surcharge: v })}
            />
          </Field>
        </div>
        <dl className="flex flex-col gap-2 self-start rounded-lg bg-muted/50 p-4 text-sm">
          {(
            [
              ['subtotal', amounts.subtotal],
              ['discount', amounts.discountAmount ? -amounts.discountAmount : 0],
              ['afterDiscount', amounts.afterDiscount],
              ['shippingCharged', amounts.shippingFeeCharged],
              ['surcharge', amounts.surcharge],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t(`orderForm.${k}`)}</dt>
              <dd className="tabular-nums">{formatVnd(v)}</dd>
            </div>
          ))}
          <div className="mt-1 flex justify-between gap-4 border-t pt-2 text-base font-semibold">
            <dt>{t('orderForm.total')}</dt>
            <dd className="tabular-nums">{formatVnd(amounts.total)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{t('orderForm.paid')}</dt>
            <dd className="tabular-nums">{formatVnd(amounts.paid)}</dd>
          </div>
          <div className="flex justify-between gap-4 font-medium">
            <dt>{amounts.remaining < 0 ? t('orderForm.overpaid') : t('orderForm.remaining')}</dt>
            <dd className={cn('tabular-nums', amounts.remaining > 0 && 'text-primary')}>
              {formatVnd(Math.abs(amounts.remaining))}
            </dd>
          </div>
        </dl>
      </div>
    </Panel>
  );
}
