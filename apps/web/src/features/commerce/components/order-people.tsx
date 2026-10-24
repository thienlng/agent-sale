import { OrderSource, type OrderStatus } from '@agent-sales/contracts';
import { useTranslation } from 'react-i18next';

import { MoneyInput } from '@/components/money-input';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { Field, Panel } from './order-form-parts';

export interface PeopleState {
  source: OrderSource;
  status: OrderStatus;
  placedAt: string;
  customer: { name: string; phone: string; email: string };
  sameAsCustomer: boolean;
  recipient: { name: string; phone: string; address: string; ward: string; province: string };
  expectedDeliveryAt: string;
  carrier: string;
  trackingCode: string;
  /** What the carrier charges the shop. */
  shippingFee: number;
}

const PHONE = '\\+?[0-9 .\\-]{8,15}';
const grid = 'grid gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2';

/** The right-hand column of the order form: details, customer, delivery, shipping. */
export function OrderPeoplePanels({
  value,
  onChange,
  statuses,
}: {
  value: PeopleState;
  onChange: (next: PeopleState) => void;
  statuses: readonly OrderStatus[];
}) {
  const { t } = useTranslation();
  const set = (patch: Partial<PeopleState>) => onChange({ ...value, ...patch });
  const setCustomer = (patch: Partial<PeopleState['customer']>) =>
    set({ customer: { ...value.customer, ...patch } });
  const setRecipient = (patch: Partial<PeopleState['recipient']>) =>
    set({ recipient: { ...value.recipient, ...patch } });

  return (
    <>
      <Panel title={t('orderForm.info')}>
        <div className={grid}>
          <Field id="of-placed" label={t('orderForm.placedAt')}>
            <Input
              id="of-placed"
              type="datetime-local"
              required
              value={value.placedAt}
              onChange={(e) => set({ placedAt: e.target.value })}
            />
          </Field>
          <Field id="of-source" label={t('orderForm.source')}>
            <Select value={value.source} onValueChange={(v) => set({ source: v as OrderSource })}>
              <SelectTrigger id="of-source" className="w-full">
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
          </Field>
          <Field id="of-status" label={t('orderForm.status')}>
            <Select value={value.status} onValueChange={(v) => set({ status: v as OrderStatus })}>
              <SelectTrigger id="of-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`status.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </Panel>

      <Panel title={t('orderForm.customer')}>
        <div className={grid}>
          <Field id="of-c-name" label={t('orderForm.name')}>
            <Input
              id="of-c-name"
              required
              maxLength={120}
              autoComplete="off"
              value={value.customer.name}
              onChange={(e) => setCustomer({ name: e.target.value })}
            />
          </Field>
          <Field id="of-c-phone" label={t('orderForm.phone')}>
            <Input
              id="of-c-phone"
              required
              type="tel"
              inputMode="tel"
              pattern={PHONE}
              autoComplete="off"
              value={value.customer.phone}
              onChange={(e) => setCustomer({ phone: e.target.value })}
            />
          </Field>
          <Field id="of-c-email" label={t('orderForm.email')}>
            <Input
              id="of-c-email"
              type="email"
              autoComplete="off"
              value={value.customer.email}
              onChange={(e) => setCustomer({ email: e.target.value })}
            />
          </Field>
        </div>
      </Panel>

      <Panel title={t('orderForm.recipient')}>
        <div className="flex flex-col gap-4">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={value.sameAsCustomer}
              onCheckedChange={(c) => set({ sameAsCustomer: c === true })}
            />
            {t('orderForm.sameAsCustomer')}
          </label>
          {!value.sameAsCustomer ? (
            <div className={grid}>
              <Field id="of-r-name" label={t('orderForm.name')}>
                <Input
                  id="of-r-name"
                  required
                  maxLength={120}
                  value={value.recipient.name}
                  onChange={(e) => setRecipient({ name: e.target.value })}
                />
              </Field>
              <Field id="of-r-phone" label={t('orderForm.phone')}>
                <Input
                  id="of-r-phone"
                  required
                  type="tel"
                  pattern={PHONE}
                  value={value.recipient.phone}
                  onChange={(e) => setRecipient({ phone: e.target.value })}
                />
              </Field>
            </div>
          ) : null}
          <Field id="of-r-address" label={t('orderForm.address')}>
            <Input
              id="of-r-address"
              required
              maxLength={300}
              value={value.recipient.address}
              onChange={(e) => setRecipient({ address: e.target.value })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="of-r-ward" label={t('orderForm.ward')}>
              <Input
                id="of-r-ward"
                maxLength={120}
                value={value.recipient.ward}
                onChange={(e) => setRecipient({ ward: e.target.value })}
              />
            </Field>
            <Field id="of-r-province" label={t('orderForm.province')}>
              <Input
                id="of-r-province"
                maxLength={120}
                value={value.recipient.province}
                onChange={(e) => setRecipient({ province: e.target.value })}
              />
            </Field>
          </div>
          <Field id="of-expected" label={t('orderForm.expectedDelivery')}>
            <Input
              id="of-expected"
              type="datetime-local"
              value={value.expectedDeliveryAt}
              onChange={(e) => set({ expectedDeliveryAt: e.target.value })}
            />
          </Field>
        </div>
      </Panel>

      <Panel title={t('orderForm.shipping')}>
        <div className={grid}>
          <Field id="of-carrier" label={t('orderForm.carrier')}>
            <Input
              id="of-carrier"
              maxLength={60}
              placeholder="GHN, GHTK, Viettel Post…"
              value={value.carrier}
              onChange={(e) => set({ carrier: e.target.value })}
            />
          </Field>
          <Field id="of-tracking" label={t('orderForm.tracking')}>
            <Input
              id="of-tracking"
              maxLength={60}
              value={value.trackingCode}
              onChange={(e) => set({ trackingCode: e.target.value })}
            />
          </Field>
          <Field id="of-carrier-fee" label={t('orderForm.carrierFee')}>
            <MoneyInput
              id="of-carrier-fee"
              value={value.shippingFee}
              onValueChange={(v) => set({ shippingFee: v })}
            />
          </Field>
        </div>
      </Panel>
    </>
  );
}
