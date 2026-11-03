import type { ProductDto, UpsertProductRequest } from '@agent-sales/contracts';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronLeft, Lock, Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { MoneyInput } from '@/components/money-input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAssistantForm } from '@/lib/assistant-context';
import { errorMessage } from '@/lib/errors';
import { productSaveErrorMessage } from '../hooks/lodging-errors';
import { cn } from '@/lib/utils';

import { useSaveProduct, useSaveProductBotSettings } from '../api/commerce';
import { FieldLabel, LOCKED_FIELD, LockedHint } from './locked-field';
import { ProductImagesEditor } from './product-images-editor';
import { StockEditor } from './product-stock-editor';
import type { PmsLink } from './products-list';

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

/**
 * Create or edit a product with its variants (ORD-01). With `botId` (created from a bot's
 * product page) the new product is selected for that bot and the page returns there.
 *
 * A product synced from KiotViet (`product.external`) is read-only except for its bot settings,
 * which save on their own; `pmsLink` (from the route) gives the store for the "edit in KiotViet"
 * link.
 */
export function ProductForm({
  product,
  botId,
  pmsLink,
}: {
  product?: ProductDto;
  botId?: string;
  pmsLink?: PmsLink | null | undefined;
}) {
  const { t } = useTranslation();
  const { t: training } = useTranslation('training');
  const navigate = useNavigate();
  const save = useSaveProduct();
  const saveBot = useSaveProductBotSettings(product?.id ?? '');
  const locked = Boolean(product?.external);
  const retailer = pmsLink?.retailer ?? null;
  const saving = save.isPending || saveBot.isPending;
  /** Props for a read-only field described by the section's hint. */
  const lockedField = (hintId: string) =>
    locked ? { readOnly: true, 'aria-describedby': hintId, className: LOCKED_FIELD } : {};
  const [code, setCode] = useState(product?.code ?? '');
  const [name, setName] = useState(product?.name ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [category, setCategory] = useState(product?.category ?? '');
  const [botInstructions, setBotInstructions] = useState(product?.botInstructions ?? '');
  const [visibleToBot, setVisibleToBot] = useState(product?.visibleToBot ?? true);
  const [imageUrls, setImageUrls] = useState<string[]>(product?.imageUrls ?? []);
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

  // The owner assistant may fill a new product's main fields (the first variant's SKU, price,
  // cost and weight; the SKU is required to save);
  // the owner reviews them and saves. Editing an existing product is a proposal, not a fill.
  const first = variants[0];
  useAssistantForm(
    'product',
    () => [
      {
        name: 'code',
        label: t('products.form.code'),
        type: 'text',
        empty: !code.trim(),
        value: code,
      },
      {
        name: 'name',
        label: t('products.form.name'),
        type: 'text',
        empty: !name.trim(),
        value: name,
      },
      {
        name: 'category',
        label: t('products.form.category'),
        type: 'text',
        empty: !category.trim(),
        value: category,
      },
      {
        name: 'description',
        label: t('products.form.description'),
        type: 'textarea',
        empty: !description.trim(),
        value: description,
      },
      {
        name: 'sku',
        label: t('products.form.sku'),
        type: 'text',
        empty: !first?.sku.trim(),
        required: true,
        value: first?.sku ?? '',
      },
      { name: 'price', label: t('products.form.price'), type: 'number', empty: !first?.price },
      { name: 'cost', label: t('products.form.cost'), type: 'number', empty: !first?.cost },
      {
        name: 'weightGram',
        label: t('products.form.weight'),
        type: 'number',
        empty: !first?.weightGram,
      },
    ],
    (values) => {
      if (typeof values['code'] === 'string') setCode(values['code'].slice(0, 64));
      if (typeof values['name'] === 'string') setName(values['name'].slice(0, 200));
      if (typeof values['category'] === 'string') setCategory(values['category'].slice(0, 120));
      if (typeof values['description'] === 'string')
        setDescription(values['description'].slice(0, 5000));
      const patch: Partial<VariantDraft> = {};
      if (typeof values['sku'] === 'string') patch.sku = values['sku'].slice(0, 64);
      if (typeof values['price'] === 'number' && values['price'] >= 0)
        patch.price = Math.round(values['price']);
      if (typeof values['cost'] === 'number' && values['cost'] >= 0)
        patch.cost = Math.round(values['cost']);
      if (typeof values['weightGram'] === 'number' && values['weightGram'] >= 0)
        patch.weightGram = Math.round(values['weightGram']);
      if (Object.keys(patch).length) setVariant(0, patch);
    },
    { submitTarget: 'products.save', enabled: !product },
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    if (product && locked) {
      saveBot.mutate(
        { visibleToBot, botInstructions },
        {
          onSuccess: () => toast.success(t('products.form.saved')),
          onError: (err) => toast.error(errorMessage(t, err)),
        },
      );
      return;
    }
    const body: UpsertProductRequest = {
      code: code.trim(),
      name: name.trim(),
      description,
      category: category.trim() || null,
      visibleToBot,
      botInstructions,
      imageUrls,
      status: archived ? 'archived' : 'active',
      ...(!product && botId ? { botId } : {}),
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
          if (!product && botId)
            void navigate({ to: '/app/bots/$botId/products', params: { botId } });
          else if (!product)
            void navigate({ to: '/app/products/$productId', params: { productId: p.id } });
        },
        onError: (err) => toast.error(productSaveErrorMessage(t, err)),
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
          {locked ? (
            <div className="md:col-span-2">
              <LockedHint id="pf-locked-hint" retailer={retailer} />
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="pf-code" locked={locked}>
              {t('products.form.code')}
            </FieldLabel>
            <Input
              id="pf-code"
              {...lockedField('pf-locked-hint')}
              required
              maxLength={64}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="pf-name" locked={locked}>
              {t('products.form.name')}
            </FieldLabel>
            <Input
              id="pf-name"
              {...lockedField('pf-locked-hint')}
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="pf-category" locked={locked}>
              {t('products.form.category')}
            </FieldLabel>
            <Input
              id="pf-category"
              {...lockedField('pf-locked-hint')}
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
            {product && locked ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Lock className="size-4" aria-hidden />
                {t(`products.${product.status}`)}
              </p>
            ) : product ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={archived} onCheckedChange={(c) => setArchived(c === true)} />
                {t('products.form.archived')}
              </label>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <Label htmlFor="pf-bot-instructions">{training('productInstructions')}</Label>
            <Textarea
              id="pf-bot-instructions"
              maxLength={4000}
              rows={3}
              value={botInstructions}
              onChange={(event) => setBotInstructions(event.target.value)}
            />
            <p className="text-sm text-muted-foreground">{training('productInstructionsHint')}</p>
          </div>
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <FieldLabel htmlFor="pf-description" locked={locked}>
              {t('products.form.description')}
            </FieldLabel>
            <Textarea
              id="pf-description"
              {...lockedField('pf-locked-hint')}
              rows={4}
              maxLength={5000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </section>

        <ProductImagesEditor
          value={imageUrls}
          onChange={setImageUrls}
          readOnly={locked}
          lockedHint={<LockedHint id="pf-images-locked-hint" retailer={retailer} />}
        />

        <section className="rounded-xl border bg-card p-4 md:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">{t('products.form.variants')}</h2>
              {locked ? (
                <div className="mt-1">
                  <LockedHint id="pv-locked-hint" retailer={retailer} />
                </div>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('products.form.variantsHint')}
                </p>
              )}
            </div>
            {locked ? null : (
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
            )}
          </div>
          <ul className="mt-4 flex flex-col gap-3">
            {variants.map((v, i) => (
              <li
                key={v.key}
                className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-[1fr_1.4fr_1fr_1fr_0.7fr_auto] lg:items-end"
              >
                <div className="flex flex-col gap-1.5">
                  <FieldLabel htmlFor={`pv-sku-${v.key}`} locked={locked}>
                    {t('products.form.sku')}
                  </FieldLabel>
                  <Input
                    id={`pv-sku-${v.key}`}
                    {...lockedField('pv-locked-hint')}
                    required
                    maxLength={64}
                    value={v.sku}
                    onChange={(e) => setVariant(i, { sku: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel htmlFor={`pv-name-${v.key}`} locked={locked}>
                    {t('products.form.variantName')}
                  </FieldLabel>
                  <Input
                    id={`pv-name-${v.key}`}
                    {...lockedField('pv-locked-hint')}
                    maxLength={120}
                    value={v.name}
                    onChange={(e) => setVariant(i, { name: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel htmlFor={`pv-price-${v.key}`} locked={locked}>
                    {t('products.form.price')}
                  </FieldLabel>
                  <MoneyInput
                    id={`pv-price-${v.key}`}
                    {...lockedField('pv-locked-hint')}
                    value={v.price}
                    onValueChange={(price) => setVariant(i, { price })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel htmlFor={`pv-cost-${v.key}`} locked={locked}>
                    {t('products.form.cost')}
                  </FieldLabel>
                  <MoneyInput
                    id={`pv-cost-${v.key}`}
                    {...lockedField('pv-locked-hint')}
                    value={v.cost}
                    onValueChange={(cost) => setVariant(i, { cost })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel htmlFor={`pv-weight-${v.key}`} locked={locked}>
                    {t('products.form.weight')}
                  </FieldLabel>
                  <Input
                    id={`pv-weight-${v.key}`}
                    {...lockedField('pv-locked-hint')}
                    inputMode="numeric"
                    className={cn('text-right tabular-nums', locked && LOCKED_FIELD)}
                    value={v.weightGram || ''}
                    onChange={(e) =>
                      setVariant(i, {
                        weightGram: Number(e.target.value.replace(/\D/g, '').slice(0, 7)) || 0,
                      })
                    }
                  />
                </div>
                {locked ? null : (
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
                )}
              </li>
            ))}
          </ul>
        </section>

        <div className="flex justify-end">
          <Button type="submit" size="lg" disabled={saving} data-assistant-target="products.save">
            {saving ? t('products.form.saving') : t('products.form.save')}
          </Button>
        </div>
      </form>

      {product ? (
        <StockEditor
          product={product}
          lockedHint={locked ? <LockedHint id="ps-locked-hint" retailer={retailer} /> : undefined}
        />
      ) : null}
    </div>
  );
}
