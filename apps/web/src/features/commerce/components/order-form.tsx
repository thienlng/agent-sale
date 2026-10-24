import type { CreateOrderRequest, OrderPolicyField, VariantOption } from '@agent-sales/contracts';
import { computeAmounts } from '@agent-sales/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { formatVnd } from '@/lib/format';

import { useCreateOrder, useWarehouses } from '../api/commerce';
import { missingFieldsOf, orderErrorMessage } from '../hooks/order-errors';
import { useOrderStatuses, useRequiredOrderFields } from '../hooks/use-order-statuses';
import { Field, nowLocal, Panel } from './order-form-parts';
import { type Line, OrderLines, ProductPicker } from './order-lines';
import { PaymentPanel, type PaymentState } from './order-payment';
import { OrderPeoplePanels, type PeopleState } from './order-people';

/** Create order (ORD-03). Totals use the same formulas as the server (`computeAmounts`). */
export function OrderForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const warehouses = useWarehouses();
  const { statuses } = useOrderStatuses();
  const create = useCreateOrder();
  const formRef = useRef<HTMLFormElement>(null);
  // One id per draft: the server returns the same order if this draft is sent twice.
  const [clientRequestId] = useState(() => crypto.randomUUID());
  // Set synchronously so a second F2/click before React re-renders cannot submit again.
  const pendingRef = useRef(false);

  const [warehouseId, setWarehouseId] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [payment, setPayment] = useState<PaymentState>({
    discountType: 'amount',
    discountValue: 0,
    shippingFeeCharged: 0,
    freeShipping: false,
    surcharge: 0,
    transferAmount: 0,
  });
  const [people, setPeople] = useState<PeopleState>(() => ({
    source: 'facebook',
    status: 'new',
    placedAt: nowLocal(),
    customer: { name: '', phone: '', email: '' },
    sameAsCustomer: true,
    recipient: { name: '', phone: '', address: '', ward: '', province: '' },
    expectedDeliveryAt: '',
    carrier: '',
    trackingCode: '',
    shippingFee: 0,
  }));
  const required = useRequiredOrderFields(people.source, people.status);
  // Fields the server said are missing; cleared as soon as the details change.
  const [missing, setMissing] = useState<ReadonlySet<OrderPolicyField>>(new Set());
  useEffect(() => setMissing(new Set()), [people]);
  const [noteInternal, setNoteInternal] = useState('');
  const [notePrint, setNotePrint] = useState('');

  useEffect(() => {
    const list = warehouses.data ?? [];
    const first = list.find((w) => w.isDefault) ?? list[0];
    if (!warehouseId && first) setWarehouseId(first.id);
  }, [warehouses.data, warehouseId]);

  const amounts = useMemo(
    () =>
      computeAmounts({
        ...payment,
        items: lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice, unitCost: 0 })),
        shippingFee: people.shippingFee,
      }),
    [lines, payment, people.shippingFee],
  );

  const addLine = (v: VariantOption) =>
    setLines((ls) => {
      const i = ls.findIndex((l) => l.variant.variantId === v.variantId);
      if (i < 0) return [...ls, { variant: v, qty: 1, unitPrice: v.price }];
      return ls.map((l, idx) => (idx === i ? { ...l, qty: l.qty + 1 } : l));
    });

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (pendingRef.current) return;
    if (!lines.length) {
      toast.error(t('orderForm.needItems'));
      return;
    }
    if (!formRef.current?.reportValidity()) return;
    const p = people;
    const to = p.sameAsCustomer
      ? { ...p.recipient, name: p.customer.name, phone: p.customer.phone }
      : p.recipient;
    const body: CreateOrderRequest = {
      source: p.source,
      warehouseId,
      status: p.status,
      placedAt: new Date(p.placedAt).toISOString(),
      customer: {
        name: p.customer.name,
        phone: p.customer.phone,
        ...(p.customer.email ? { email: p.customer.email } : {}),
      },
      recipient: {
        name: to.name,
        phone: to.phone,
        address: to.address,
        ...(to.ward ? { ward: to.ward } : {}),
        ...(to.province ? { province: to.province } : {}),
      },
      ...(p.expectedDeliveryAt
        ? { expectedDeliveryAt: new Date(p.expectedDeliveryAt).toISOString() }
        : {}),
      items: lines.map((l) => ({
        variantId: l.variant.variantId,
        qty: l.qty,
        unitPrice: l.unitPrice,
      })),
      ...payment,
      shippingFee: p.shippingFee,
      ...(p.carrier ? { carrier: p.carrier } : {}),
      ...(p.trackingCode ? { trackingCode: p.trackingCode } : {}),
      noteInternal,
      notePrint,
      clientRequestId,
    };
    pendingRef.current = true;
    create.mutate(body, {
      onSuccess: (o) => {
        toast.success(t('orderForm.created', { code: o.code }));
        void navigate({ to: '/app/orders/$orderId', params: { orderId: o.id } });
      },
      onError: (err) => {
        pendingRef.current = false;
        setMissing(new Set(missingFieldsOf(err)));
        toast.error(orderErrorMessage(t, err));
      },
    });
  };

  // F2 creates the order from anywhere on the page (as in the reference product).
  // The ref always holds this render's submit, so the shortcut never sends stale fields.
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2' && !e.repeat) {
        e.preventDefault();
        submitRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (warehouses.data && !warehouses.data.length) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center">
        <p className="text-muted-foreground">{t('orderForm.needWarehouse')}</p>
        <Button asChild className="mt-4">
          <Link to="/app/order-settings/warehouses">{t('orderForm.goWarehouses')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={submit} className="flex flex-col gap-5 pb-24">
      <h1 className="text-2xl font-semibold tracking-tight">{t('orderForm.title')}</h1>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel title={t('orderForm.products')}>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5 sm:max-w-xs">
                <Label htmlFor="of-warehouse">{t('orderForm.warehouse')}</Label>
                <Select value={warehouseId} onValueChange={setWarehouseId}>
                  <SelectTrigger id="of-warehouse" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(warehouses.data ?? []).map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {warehouseId ? <ProductPicker warehouseId={warehouseId} onPick={addLine} /> : null}
              <OrderLines lines={lines} onChange={setLines} />
            </div>
          </Panel>

          <PaymentPanel value={payment} onChange={setPayment} amounts={amounts} />

          <Panel title={t('orderForm.notes')}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field id="of-note-internal" label={t('orderForm.noteInternal')}>
                <Textarea
                  id="of-note-internal"
                  rows={3}
                  maxLength={2000}
                  value={noteInternal}
                  onChange={(e) => setNoteInternal(e.target.value)}
                />
              </Field>
              <Field id="of-note-print" label={t('orderForm.notePrint')}>
                <Textarea
                  id="of-note-print"
                  rows={3}
                  maxLength={2000}
                  value={notePrint}
                  onChange={(e) => setNotePrint(e.target.value)}
                />
              </Field>
            </div>
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <OrderPeoplePanels
            value={people}
            onChange={setPeople}
            statuses={statuses}
            required={required}
            missing={missing}
          />
        </div>
      </div>

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background/95 px-4 py-3 shadow-lg backdrop-blur">
        <div className="text-sm">
          <span className="text-muted-foreground">{t('orderForm.total')}: </span>
          <span className="text-lg font-semibold tabular-nums">{formatVnd(amounts.total)}</span>
          <span className="ml-3 text-muted-foreground">
            {t('orderForm.cod')}: <span className="tabular-nums">{formatVnd(amounts.cod)}</span>
          </span>
        </div>
        <Button type="submit" size="lg" disabled={create.isPending}>
          {create.isPending ? t('orderForm.submitting') : t('orderForm.submit')}
        </Button>
      </div>
    </form>
  );
}
