import type { OrderDto, VariantOption } from '@agent-sales/contracts';
import { computeAmounts } from '@agent-sales/shared';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

import { useUpdateOrder } from '../api/commerce';
import { orderErrorMessage } from '../hooks/order-errors';
import { type Line, OrderLines, ProductPicker } from './order-lines';
import { PaymentPanel, type PaymentState } from './order-payment';

/** A line already on the order, in the editor's shape (its price is the order's snapshot). */
function lineOf(item: OrderDto['items'][number]): Line {
  const variant: VariantOption = {
    variantId: item.variantId,
    productId: '',
    productCode: '',
    productName: item.productName,
    variantName: item.variantName,
    sku: item.sku,
    price: item.unitPrice,
    // The order already holds these; no over-stock warning for what it keeps.
    available: Number.POSITIVE_INFINITY,
  };
  return { variant, qty: item.qty, unitPrice: item.unitPrice };
}

/**
 * Edits the products and payment of an order that still holds its goods (#16).
 * The server moves the stock reservation by the difference and recomputes the totals.
 */
export function OrderItemsEditor({ order, onDone }: { order: OrderDto; onDone: () => void }) {
  const { t } = useTranslation();
  const update = useUpdateOrder(order.id);
  const a = order.amounts;
  const [lines, setLines] = useState<Line[]>(() => order.items.map(lineOf));
  const [payment, setPayment] = useState<PaymentState>({
    discountType: a.discountType,
    discountValue: a.discountValue,
    shippingFeeCharged: a.shippingFeeCharged,
    freeShipping: a.freeShipping,
    surcharge: a.surcharge,
    transferAmount: a.transferAmount,
  });
  const amounts = useMemo(
    () =>
      computeAmounts({
        ...payment,
        items: lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice, unitCost: 0 })),
        shippingFee: a.shippingFee,
      }),
    [lines, payment, a.shippingFee],
  );

  const addLine = (v: VariantOption) =>
    setLines((ls) => {
      const i = ls.findIndex((l) => l.variant.variantId === v.variantId);
      if (i < 0) return [...ls, { variant: v, qty: 1, unitPrice: v.price }];
      return ls.map((l, idx) => (idx === i ? { ...l, qty: l.qty + 1 } : l));
    });

  const save = () => {
    if (!lines.length) {
      toast.error(t('orderForm.needItems'));
      return;
    }
    update.mutate(
      {
        items: lines.map((l) => ({
          variantId: l.variant.variantId,
          qty: l.qty,
          unitPrice: l.unitPrice,
        })),
        ...payment,
      },
      {
        onSuccess: () => {
          toast.success(t('orderDetail.itemsSaved'));
          onDone();
        },
        onError: (err) => toast.error(orderErrorMessage(t, err)),
      },
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3 rounded-xl border bg-card p-4 md:p-5">
        <h2 className="font-semibold">{t('orderDetail.editItems')}</h2>
        <ProductPicker warehouseId={order.warehouseId} onPick={addLine} />
        <OrderLines lines={lines} onChange={setLines} />
      </section>
      <PaymentPanel value={payment} onChange={setPayment} amounts={amounts} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          {t('orderDetail.cancel')}
        </Button>
        <Button disabled={update.isPending} onClick={save}>
          {t('orderDetail.save')}
        </Button>
      </div>
    </div>
  );
}
