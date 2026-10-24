import type { OrderDto, OrderPolicyField } from '@agent-sales/contracts';
import { Pencil } from 'lucide-react';
import { type ComponentProps, type FormEvent, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDateTime } from '@/lib/format';

import { useUpdateOrder } from '../api/commerce';
import { missingFieldsOf, orderErrorMessage } from '../hooks/order-errors';
import { useRequiredOrderFields } from '../hooks/use-order-statuses';
import { Field } from './order-form-parts';

const PHONE = '\\+?[0-9 .\\-]{8,15}';

type Draft = {
  customer: { name: string; phone: string; email: string };
  recipient: { name: string; phone: string; address: string; ward: string; province: string };
};

const draftOf = (o: OrderDto): Draft => ({
  customer: {
    name: o.customer.name,
    phone: o.customer.phone ?? '',
    email: o.customer.email ?? '',
  },
  recipient: {
    name: o.recipient.name,
    phone: o.recipient.phone ?? '',
    address: o.recipient.address ?? '',
    ward: o.recipient.ward ?? '',
    province: o.recipient.province ?? '',
  },
});

/**
 * Customer and delivery details of an order, editable in place — e.g. to complete
 * a phone draft before it is confirmed. Required fields follow the source policy
 * for the stage the order is in.
 */
export function OrderPeoplePanel({ order }: { order: OrderDto }) {
  const { t } = useTranslation();
  const update = useUpdateOrder(order.id);
  const required = useRequiredOrderFields(order.source, order.status);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [missing, setMissing] = useState<ReadonlySet<OrderPolicyField>>(new Set());

  const header = (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="font-semibold">{t('orderDetail.people')}</h2>
      {draft ? null : (
        <Button variant="ghost" size="sm" onClick={() => setDraft(draftOf(order))}>
          <Pencil />
          {t('orderDetail.edit')}
        </Button>
      )}
    </div>
  );

  if (!draft) {
    return (
      <section className="rounded-xl border bg-card p-4 md:p-5">
        {header}
        <div className="grid gap-4 text-sm md:grid-cols-2">
          <div>
            <div className="text-muted-foreground">{t('orderForm.customer')}</div>
            <div className="mt-1 font-medium">{order.customer.name}</div>
            <div className="tabular-nums">{order.customer.phone ?? '—'}</div>
            {order.customer.email ? (
              <div className="text-muted-foreground">{order.customer.email}</div>
            ) : null}
          </div>
          <div>
            <div className="text-muted-foreground">{t('orderForm.recipient')}</div>
            <div className="mt-1 font-medium">{order.recipient.name}</div>
            <div className="tabular-nums">{order.recipient.phone ?? '—'}</div>
            <div className="mt-1">
              {[order.recipient.address, order.recipient.ward, order.recipient.province]
                .filter(Boolean)
                .join(', ') || '—'}
            </div>
            {order.expectedDeliveryAt ? (
              <div className="mt-1 text-muted-foreground">
                {t('orderForm.expectedDelivery')}: {formatDateTime(order.expectedDeliveryAt)}
              </div>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  const c = draft.customer;
  const r = draft.recipient;
  const setC = (patch: Partial<Draft['customer']>) =>
    setDraft({ ...draft, customer: { ...c, ...patch } });
  const setR = (patch: Partial<Draft['recipient']>) =>
    setDraft({ ...draft, recipient: { ...r, ...patch } });
  const input = (
    id: string,
    field: OrderPolicyField | null,
    value: string,
    onValue: (v: string) => void,
    extra: Partial<ComponentProps<typeof Input>> = {},
  ) => {
    const isMissing = field ? missing.has(field) : false;
    return (
      <Input
        id={id}
        value={value}
        onChange={(e) => onValue(e.target.value)}
        required={field ? required.has(field) : false}
        {...(isMissing ? { 'aria-invalid': true, 'aria-describedby': `${id}-error` } : {})}
        {...extra}
      />
    );
  };
  const field = (id: string, label: string, f: OrderPolicyField | null, node: ReactNode) => (
    <Field
      id={id}
      label={label}
      required={f ? required.has(f) : false}
      error={f && missing.has(f) ? t('errors.required') : undefined}
    >
      {node}
    </Field>
  );

  const save = (e: FormEvent) => {
    e.preventDefault();
    update.mutate(
      {
        customer: { name: c.name, phone: c.phone, email: c.email },
        recipient: {
          name: r.name,
          phone: r.phone,
          address: r.address,
          ...(r.ward ? { ward: r.ward } : {}),
          ...(r.province ? { province: r.province } : {}),
        },
      },
      {
        onSuccess: () => {
          toast.success(t('orderDetail.peopleSaved'));
          setMissing(new Set());
          setDraft(null);
        },
        onError: (err) => {
          setMissing(new Set(missingFieldsOf(err)));
          toast.error(orderErrorMessage(t, err));
        },
      },
    );
  };

  return (
    <form onSubmit={save} className="rounded-xl border bg-card p-4 md:p-5">
      {header}
      <div className="grid gap-4 md:grid-cols-2">
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm text-muted-foreground">{t('orderForm.customer')}</legend>
          {field(
            'od-c-name',
            t('orderForm.name'),
            null,
            input('od-c-name', null, c.name, (v) => setC({ name: v }), {
              required: true,
              maxLength: 120,
            }),
          )}
          {field(
            'od-c-phone',
            t('orderForm.phone'),
            'customerPhone',
            input('od-c-phone', 'customerPhone', c.phone, (v) => setC({ phone: v }), {
              type: 'tel',
              pattern: PHONE,
            }),
          )}
          {field(
            'od-c-email',
            t('orderForm.email'),
            'customerEmail',
            input('od-c-email', 'customerEmail', c.email, (v) => setC({ email: v }), {
              type: 'email',
            }),
          )}
        </fieldset>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm text-muted-foreground">{t('orderForm.recipient')}</legend>
          {field(
            'od-r-name',
            t('orderForm.name'),
            null,
            input('od-r-name', null, r.name, (v) => setR({ name: v }), {
              required: true,
              maxLength: 120,
            }),
          )}
          {field(
            'od-r-phone',
            t('orderForm.phone'),
            'recipientPhone',
            input('od-r-phone', 'recipientPhone', r.phone, (v) => setR({ phone: v }), {
              type: 'tel',
              pattern: PHONE,
            }),
          )}
          {field(
            'od-r-address',
            t('orderForm.address'),
            'recipientAddress',
            input('od-r-address', 'recipientAddress', r.address, (v) => setR({ address: v }), {
              maxLength: 300,
            }),
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {field(
              'od-r-ward',
              t('orderForm.ward'),
              null,
              input('od-r-ward', null, r.ward, (v) => setR({ ward: v }), { maxLength: 120 }),
            )}
            {field(
              'od-r-province',
              t('orderForm.province'),
              null,
              input('od-r-province', null, r.province, (v) => setR({ province: v }), {
                maxLength: 120,
              }),
            )}
          </div>
        </fieldset>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setMissing(new Set());
            setDraft(null);
          }}
        >
          {t('orderDetail.cancel')}
        </Button>
        <Button type="submit" disabled={update.isPending}>
          {t('orderDetail.save')}
        </Button>
      </div>
    </form>
  );
}
