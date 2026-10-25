import type { VariantOption } from '@agent-sales/contracts';
import { Minus, PackageSearch, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MoneyInput } from '@/components/money-input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { formatVnd } from '@/lib/format';
import { cn } from '@/lib/utils';

import { useVariantSearch } from '../api/commerce';

export interface Line {
  variant: VariantOption;
  qty: number;
  unitPrice: number;
}

/** Search box over the chosen warehouse's variants, with stock shown per result. */
export function ProductPicker({
  warehouseId,
  onPick,
  compact = false,
}: {
  warehouseId: string;
  compact?: boolean;
  onPick: (v: VariantOption) => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [inStock, setInStock] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(id);
  }, [q]);
  const results = useVariantSearch({ q: debounced, warehouseId, inStock });

  return (
    <div className={cn('flex min-w-0 flex-col gap-2', !compact && 'sm:flex-row sm:items-center')}>
      <Popover open={open} onOpenChange={setOpen}>
        <Command shouldFilter={false} className="flex-1 overflow-visible rounded-lg border">
          <PopoverAnchor asChild>
            <div>
              <CommandInput
                value={q}
                onValueChange={(v) => {
                  setQ(v);
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                placeholder={t('orderForm.searchProduct')}
              />
            </div>
          </PopoverAnchor>
          <PopoverContent
            align="start"
            className="w-(--radix-popover-trigger-width) min-w-72 p-0"
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <CommandList>
              <CommandEmpty>{t('orderForm.noProducts')}</CommandEmpty>
              <CommandGroup>
                {(results.data ?? []).map((v) => (
                  <CommandItem
                    key={v.variantId}
                    value={v.variantId}
                    onSelect={() => {
                      onPick(v);
                      setOpen(false);
                    }}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{v.productName}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[v.variantName, v.sku].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block tabular-nums">{formatVnd(v.price)}</span>
                      <span
                        className={cn(
                          'block text-xs tabular-nums',
                          v.available > 0 ? 'text-success' : 'text-destructive',
                        )}
                      >
                        {t('orderForm.available', { count: v.available })}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </PopoverContent>
        </Command>
      </Popover>
      <label className="flex shrink-0 items-center gap-2 text-sm">
        <Checkbox checked={inStock} onCheckedChange={(c) => setInStock(c === true)} />
        {t('orderForm.inStock')}
      </label>
    </div>
  );
}

/** The order's lines: quantity steppers, editable unit price, line totals. */
export function OrderLines({
  lines,
  onChange,
}: {
  lines: Line[];
  onChange: (lines: Line[]) => void;
}) {
  const { t } = useTranslation();
  const set = (i: number, patch: Partial<Line>) =>
    onChange(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  if (!lines.length) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        <PackageSearch className="size-5 text-primary" aria-hidden />
        {t('orderForm.pickHint')}
      </p>
    );
  }
  return (
    <ul className="divide-y rounded-lg border">
      {lines.map((l, i) => (
        <li key={l.variant.variantId} className="flex flex-wrap items-center gap-3 p-3">
          <div className="min-w-0 flex-1 basis-48">
            <div className="truncate font-medium">{l.variant.productName}</div>
            <div className="truncate text-xs text-muted-foreground">
              {[l.variant.variantName, l.variant.sku].filter(Boolean).join(' · ')}
            </div>
            {/* Overselling is allowed (pre-orders, untracked stock) but never silent. */}
            {l.qty > l.variant.available ? (
              <div className="text-xs text-warning">
                {t('orderForm.overStock', { count: Math.max(l.variant.available, 0) })}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="−"
              onClick={() => set(i, { qty: Math.max(1, l.qty - 1) })}
            >
              <Minus />
            </Button>
            <Input
              aria-label={t('orderForm.qty')}
              inputMode="numeric"
              className="h-8 w-14 text-center tabular-nums"
              value={l.qty}
              onChange={(e) =>
                set(i, {
                  qty: Math.max(
                    1,
                    Math.min(10_000, Number(e.target.value.replace(/\D/g, '')) || 1),
                  ),
                })
              }
            />
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="+"
              onClick={() => set(i, { qty: l.qty + 1 })}
            >
              <Plus />
            </Button>
          </div>
          <MoneyInput
            aria-label={t('orderForm.price')}
            className="h-8 w-32"
            value={l.unitPrice}
            onValueChange={(v) => set(i, { unitPrice: v })}
          />
          <div className="w-28 text-right font-medium tabular-nums">
            {formatVnd(l.qty * l.unitPrice)}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('orderForm.remove')}
            onClick={() => onChange(lines.filter((_, idx) => idx !== i))}
          >
            <Trash2 />
          </Button>
        </li>
      ))}
    </ul>
  );
}
