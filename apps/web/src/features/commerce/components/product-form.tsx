import type { ProductDto, UpsertProductRequest } from '@agent-sales/contracts';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronLeft, Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { MoneyInput } from '@/components/money-input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/errors';
import { formatNumber } from '@/lib/format';

import { useAdjustStock, useSaveProduct, useWarehouses } from '../api/commerce';

interface VariantDraft {
  key: string;
  id?: string;
  sku: string;
  name: string;
  price: number;
  cost: number;
  weightGram: number;
}

let seq = 0;
const blankVariant = (code = ''): VariantDraft => ({
  key: `v${++seq}`,
  sku: code,
  name: '',
  price: 0,
  cost: 0,
  weightGram: 0,
});

/** Stock per warehouse for each variant; a stock-take sets the counted quantity. */
function StockEditor({ product }: { product: ProductDto }) {
  const { t } = useTranslation();
  const warehouses = useWarehouses();
  const adjust = useAdjustStock(product.id);
  const [counts, setCounts] = useState<Record<string, string>>({});

  return (
    <section className="rounded-xl border bg-card p-4 md:p-5">
      <h2 className="font-semibold">{t('products.stock.title')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('products.stock.hint')}</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-3 font-medium">{t('products.form.sku')}</th>
              <th className="py-2 pr-3 font-medium">{t('products.stock.warehouse')}</th>
              <th className="py-2 pr-3 text-right font-medium">{t('products.stock.onHand')}</th>
              <th className="py-2 pr-3 text-right font-medium">{t('products.stock.reserved')}</th>
              <th className="py-2 pr-3 text-right font-medium">{t('products.stock.available')}</th>
              <th className="py-2" />
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
                    <td className="py-2 pr-3 text-right">
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
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatNumber(s?.reserved ?? 0)}
                    </td>
                    <td className="py-2 pr-3 text-right font-medium tabular-nums">
                      {formatNumber(s?.available ?? 0)}
                    </td>
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

/** Create or edit a product with its variants (ORD-01). */
export function ProductForm({ product }: { product?: ProductDto }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const save = useSaveProduct();
  const [code, setCode] = useState(product?.code ?? '');
  const [name, setName] = useState(product?.name ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [category, setCategory] = useState(product?.category ?? '');
  const [visibleToBot, setVisibleToBot] = useState(product?.visibleToBot ?? true);
  const [archived, setArchived] = useState(product?.status === 'archived');
  const [variants, setVariants] = useState<VariantDraft[]>(
    product?.variants.map((v) => ({
      key: v.id,
      id: v.id,
      sku: v.sku,
      name: v.name,
      price: v.price,
      cost: v.cost,
      weightGram: v.weightGram,
    })) ?? [blankVariant()],
  );
  const setVariant = (i: number, patch: Partial<VariantDraft>) =>
    setVariants((vs) => vs.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));

  function submit(e: FormEvent) {
    e.preventDefault();
    const body: UpsertProductRequest = {
      code: code.trim(),
      name: name.trim(),
      description,
      category: category.trim() || null,
      visibleToBot,
      status: archived ? 'archived' : 'active',
      variants: variants.map((v) => ({
        ...(v.id ? { id: v.id } : {}),
        sku: v.sku.trim(),
        name: v.name.trim(),
        price: v.price,
        cost: v.cost,
        weightGram: v.weightGram,
      })),
    };
    save.mutate(
      { ...(product ? { id: product.id } : {}), body },
      {
        onSuccess: (p) => {
          toast.success(product ? t('products.form.saved') : t('products.form.created'));
          if (!product)
            void navigate({ to: '/app/products/$productId', params: { productId: p.id } });
        },
        onError: (err) => toast.error(errorMessage(t, err)),
      },
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <Link
          to="/app/products"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {t('products.title')}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {product ? t('products.form.editTitle') : t('products.form.newTitle')}
        </h1>
      </header>

      <form onSubmit={submit} className="flex flex-col gap-5">
        <section className="grid gap-4 rounded-xl border bg-card p-4 md:grid-cols-2 md:p-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pf-code">{t('products.form.code')}</Label>
            <Input
              id="pf-code"
              required
              maxLength={64}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pf-name">{t('products.form.name')}</Label>
            <Input
              id="pf-name"
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pf-category">{t('products.form.category')}</Label>
            <Input
              id="pf-category"
              maxLength={120}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>
          <div className="flex flex-col justify-end gap-3 pb-1">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={visibleToBot}
                onCheckedChange={(c) => setVisibleToBot(c === true)}
              />
              {t('products.form.visibleToBot')}
            </label>
            {product ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={archived} onCheckedChange={(c) => setArchived(c === true)} />
                {t('products.form.archived')}
              </label>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <Label htmlFor="pf-description">{t('products.form.description')}</Label>
            <Textarea
              id="pf-description"
              rows={4}
              maxLength={5000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </section>

        <section className="rounded-xl border bg-card p-4 md:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">{t('products.form.variants')}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('products.form.variantsHint')}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setVariants((vs) => [...vs, blankVariant(code ? `${code}-${vs.length + 1}` : '')])
              }
            >
              <Plus />
              {t('products.form.addVariant')}
            </Button>
          </div>
          <ul className="mt-4 flex flex-col gap-3">
            {variants.map((v, i) => (
              <li
                key={v.key}
                className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-[1fr_1.4fr_1fr_1fr_0.7fr_auto] lg:items-end"
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`pv-sku-${v.key}`}>{t('products.form.sku')}</Label>
                  <Input
                    id={`pv-sku-${v.key}`}
                    required
                    maxLength={64}
                    value={v.sku}
                    onChange={(e) => setVariant(i, { sku: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`pv-name-${v.key}`}>{t('products.form.variantName')}</Label>
                  <Input
                    id={`pv-name-${v.key}`}
                    maxLength={120}
                    value={v.name}
                    onChange={(e) => setVariant(i, { name: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`pv-price-${v.key}`}>{t('products.form.price')}</Label>
                  <MoneyInput
                    id={`pv-price-${v.key}`}
                    value={v.price}
                    onValueChange={(price) => setVariant(i, { price })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`pv-cost-${v.key}`}>{t('products.form.cost')}</Label>
                  <MoneyInput
                    id={`pv-cost-${v.key}`}
                    value={v.cost}
                    onValueChange={(cost) => setVariant(i, { cost })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`pv-weight-${v.key}`}>{t('products.form.weight')}</Label>
                  <Input
                    id={`pv-weight-${v.key}`}
                    inputMode="numeric"
                    className="text-right tabular-nums"
                    value={v.weightGram || ''}
                    onChange={(e) =>
                      setVariant(i, {
                        weightGram: Number(e.target.value.replace(/\D/g, '').slice(0, 7)) || 0,
                      })
                    }
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={variants.length === 1}
                  aria-label={t('products.form.removeVariant')}
                  onClick={() => setVariants((vs) => vs.filter((_, idx) => idx !== i))}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        </section>

        <div className="flex justify-end">
          <Button type="submit" size="lg" disabled={save.isPending}>
            {save.isPending ? t('products.form.saving') : t('products.form.save')}
          </Button>
        </div>
      </form>

      {product ? <StockEditor product={product} /> : null}
    </div>
  );
}
