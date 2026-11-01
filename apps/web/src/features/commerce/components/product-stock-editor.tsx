import type { ProductDto } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/errors';
import { formatNumber } from '@/lib/format';

import { useAdjustStock, useWarehouses } from '../api/commerce';

/**
 * Stock per warehouse for each variant; a stock-take sets the counted quantity. With `lockedHint`
 * (stock owned by a PMS) the quantities are shown without the stock-take controls.
 */
export function StockEditor({
  product,
  lockedHint,
}: {
  product: ProductDto;
  lockedHint?: ReactNode;
}) {
  const { t } = useTranslation();
  const warehouses = useWarehouses();
  const adjust = useAdjustStock(product.id);
  const [counts, setCounts] = useState<Record<string, string>>({});

  return (
    <section className="rounded-xl border bg-card p-4 md:p-5">
      <h2 className="font-semibold">{t('products.stock.title')}</h2>
      {lockedHint ? (
        <div className="mt-1">{lockedHint}</div>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">{t('products.stock.hint')}</p>
      )}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-3 font-medium">{t('products.form.sku')}</th>
              <th className="py-2 pr-3 font-medium">{t('products.stock.warehouse')}</th>
              <th className="py-2 pr-3 text-right font-medium">{t('products.stock.onHand')}</th>
              <th className="py-2 pr-3 text-right font-medium">{t('products.stock.reserved')}</th>
              <th className="py-2 pr-3 text-right font-medium">{t('products.stock.available')}</th>
              {lockedHint ? null : <th className="py-2" />}
            </tr>
          </thead>
          <tbody>
            {product.variants.flatMap((v) =>
              (warehouses.data ?? []).map((w) => {
                const s = v.stock.find((x) => x.warehouseId === w.id);
                const key = `${v.id}:${w.id}`;
                const draft = counts[key] ?? String(s?.onHand ?? 0);
                const changed = Number(draft) !== (s?.onHand ?? 0);
                return (
                  <tr key={key} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{v.sku}</div>
                      <div className="text-xs text-muted-foreground">{v.name}</div>
                    </td>
                    <td className="py-2 pr-3">{w.name}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {lockedHint ? (
                        formatNumber(s?.onHand ?? 0)
                      ) : (
                        <Input
                          aria-label={`${v.sku} ${w.name} ${t('products.stock.onHand')}`}
                          inputMode="numeric"
                          className="ml-auto h-8 w-24 text-right tabular-nums"
                          value={draft}
                          onChange={(e) =>
                            setCounts({
                              ...counts,
                              [key]: e.target.value.replace(/\D/g, '').slice(0, 8),
                            })
                          }
                        />
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatNumber(s?.reserved ?? 0)}
                    </td>
                    <td className="py-2 pr-3 text-right font-medium tabular-nums">
                      {formatNumber(s?.available ?? 0)}
                    </td>
                    {lockedHint ? null : (
                      <td className="py-2 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!changed || adjust.isPending}
                          onClick={() =>
                            adjust.mutate(
                              { variantId: v.id, warehouseId: w.id, onHand: Number(draft || 0) },
                              {
                                onSuccess: () => {
                                  setCounts(({ [key]: _done, ...rest }) => rest);
                                  toast.success(t('products.stock.updated'));
                                },
                                onError: (err) => toast.error(errorMessage(t, err)),
                              },
                            )
                          }
                        >
                          {t('products.stock.update')}
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </div>
      {warehouses.data && !warehouses.data.length ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {t('warehouses.empty')}{' '}
          <Link to="/app/order-settings/warehouses" className="text-primary hover:underline">
            {t('orderForm.goWarehouses')}
          </Link>
        </p>
      ) : null}
    </section>
  );
}
