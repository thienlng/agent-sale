import type { OrderSortColumn, OrderStatus } from '@agent-sales/contracts';
import {
  ArrowDown,
  ArrowDownWideNarrow,
  ArrowUp,
  ArrowUpNarrowWide,
  Check,
  ChevronDown,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import {
  ChecklistEditor,
  DateEditor,
  ExcludeToggle,
  MoneyEditor,
  TextEditor,
} from './order-column-editors';
import {
  clearColumn,
  type ColumnMenuSpec,
  columnSortDir,
  isColumnFiltered,
  listCounts,
  listOptions,
  type OrderFilterContext,
} from './order-column-filters';
import type { MoneyBoundKey, OrdersSearch } from './orders-search';

type Patch = Partial<OrdersSearch>;

/** The column's own URL keys, as they are now. */
function pickColumn(spec: ColumnMenuSpec, search: OrdersSearch): Patch {
  return Object.fromEntries(
    Object.keys(clearColumn(spec)).map((k) => [k, search[k as keyof OrdersSearch]]),
  ) as Patch;
}

/** A draft made URL-ready: empty means unset, ranges are ordered, "everything ticked" is no filter. */
function normalize(
  spec: ColumnMenuSpec,
  draft: Patch,
  t: TFunction,
  ctx: OrderFilterContext,
): Patch {
  const f = spec.filter;
  switch (f.kind) {
    case 'text':
      return { [f.param]: draft[f.param]?.trim() || undefined };
    case 'list': {
      const chosen = draft[f.param] ?? [];
      const all = listOptions(f.param, t, ctx, chosen);
      const everything = all.length > 1 && all.every((o) => chosen.includes(o.value));
      return { [f.param]: chosen.length && !everything ? chosen : undefined };
    }
    case 'money': {
      const min = draft[`${f.param}Min` as MoneyBoundKey];
      const max = draft[`${f.param}Max` as MoneyBoundKey];
      const swap = min !== undefined && max !== undefined && min > max;
      return {
        [`${f.param}Min`]: swap ? max : min,
        [`${f.param}Max`]: swap ? min : max,
      };
    }
    case 'date':
      return draft.from
        ? { from: draft.from, to: draft.to ?? draft.from }
        : { from: undefined, to: undefined };
    case 'status': {
      const status = draft.status?.length ? draft.status : undefined;
      return {
        status,
        statusMode: status && draft.statusMode === 'exclude' ? 'exclude' : undefined,
      };
    }
  }
}

/**
 * Sort items, the column's filter and "Xoá lọc cột" / "Áp dụng": the body of a header menu
 * (popover on desktop, a section of the "Lọc & sắp xếp" sheet on phones).
 */
export function ColumnMenuBody({
  spec,
  search,
  onChange,
  ctx,
  onDone,
}: {
  spec: ColumnMenuSpec;
  search: OrdersSearch;
  onChange: (patch: Patch) => void;
  ctx: OrderFilterContext;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const label = t(spec.header);
  const [draft, setDraft] = useState<Patch>(() => pickColumn(spec, search));
  const set = (patch: Patch) => setDraft((d) => ({ ...d, ...patch }));
  const apply = () => {
    onChange(normalize(spec, draft, t, ctx));
    onDone();
  };
  const sortDir = columnSortDir(spec, search);
  const sortColumn = spec.sort;
  const sortBy = (column: OrderSortColumn, dir: 'asc' | 'desc') => {
    // Choosing the active order again goes back to the default (newest first).
    onChange({ sort: sortDir === dir ? undefined : `${column}_${dir}` });
    onDone();
  };

  const f = spec.filter;
  let editor: React.ReactNode;
  switch (f.kind) {
    case 'text':
      editor = (
        <TextEditor
          label={label}
          value={draft[f.param] ?? ''}
          onChange={(v) => set({ [f.param]: v })}
          onSubmit={apply}
        />
      );
      break;
    case 'list': {
      const chosen = draft[f.param] ?? [];
      editor = (
        <ChecklistEditor
          label={label}
          options={listOptions(f.param, t, ctx, chosen)}
          counts={listCounts(f.param, ctx)}
          chosen={chosen}
          onChange={(next) => set({ [f.param]: next })}
          searchable={f.searchable}
        />
      );
      break;
    }
    case 'money': {
      const [minKey, maxKey] = [`${f.param}Min`, `${f.param}Max`] as const;
      editor = (
        <MoneyEditor
          min={draft[minKey]}
          max={draft[maxKey]}
          onChange={({ min, max }) => set({ [minKey]: min, [maxKey]: max })}
          onSubmit={apply}
        />
      );
      break;
    }
    case 'date':
      editor = (
        <DateEditor
          from={draft.from}
          to={draft.to}
          onChange={set}
          onPreset={(r) => {
            onChange(r);
            onDone();
          }}
        />
      );
      break;
    case 'status':
      editor = (
        <>
          <ChecklistEditor
            label={label}
            options={ctx.statuses.map((s) => ({ value: s, label: t(`status.${s}`) }))}
            counts={ctx.statusCounts}
            chosen={draft.status ?? []}
            onChange={(next) => set({ status: next as OrderStatus[] })}
            searchable={false}
          />
          <ExcludeToggle
            checked={draft.statusMode === 'exclude'}
            onChange={(c) => set({ statusMode: c ? 'exclude' : undefined })}
          />
        </>
      );
      break;
  }

  return (
    <div className="flex flex-col gap-2">
      {sortColumn ? (
        <div className="-mx-1 flex flex-col border-b pb-1.5">
          {(['asc', 'desc'] as const).map((dir) => {
            const Icon = dir === 'asc' ? ArrowUpNarrowWide : ArrowDownWideNarrow;
            return (
              <button
                key={dir}
                type="button"
                aria-pressed={sortDir === dir}
                onClick={() => sortBy(sortColumn, dir)}
                className="flex min-h-8 items-center gap-2 rounded-md px-1.5 text-left hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <Icon className="size-4 text-muted-foreground" aria-hidden />
                <span className="flex-1">
                  {t(dir === 'asc' ? 'orders.columnMenu.sortAsc' : 'orders.columnMenu.sortDesc')}
                </span>
                {sortDir === dir ? <Check className="size-4 text-primary" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
      {editor}
      <div className="flex items-center justify-between gap-2 border-t pt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!isColumnFiltered(spec, search)}
          onClick={() => {
            onChange(clearColumn(spec));
            onDone();
          }}
        >
          {t('orders.columnMenu.clearColumn')}
        </Button>
        <Button type="button" size="sm" onClick={apply}>
          {t('orders.columnMenu.apply')}
        </Button>
      </div>
    </div>
  );
}

/** The header's accessible name: label, then what is going on in that column. */
export function columnStateLabel(
  t: TFunction,
  spec: ColumnMenuSpec,
  search: OrdersSearch,
  pending = 0,
): string {
  const dir = columnSortDir(spec, search);
  return [
    t(spec.header),
    isColumnFiltered(spec, search) ? t('orders.columnMenu.stateFiltered') : null,
    dir ? t(dir === 'asc' ? 'orders.columnMenu.stateAsc' : 'orders.columnMenu.stateDesc') : null,
    pending ? t('orders.review.filterCount', { count: pending }) : null,
  ]
    .filter(Boolean)
    .join(', ');
}

/** A table header that opens its column's sort/filter menu (Excel-style). */
export function OrderColumnMenu({
  spec,
  search,
  onChange,
  ctx,
  align,
}: {
  spec: ColumnMenuSpec;
  search: OrdersSearch;
  onChange: (patch: Patch) => void;
  ctx: OrderFilterContext;
  align?: 'right' | undefined;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const filtered = isColumnFiltered(spec, search);
  const dir = columnSortDir(spec, search);
  const pending = spec.id === 'creator' ? ctx.pendingReview : 0;
  const SortIcon = dir === 'asc' ? ArrowUp : ArrowDown;

  const trigger = (
    <PopoverTrigger asChild>
      <button
        type="button"
        aria-label={columnStateLabel(t, spec, search, pending)}
        className={cn(
          'group -mx-1.5 inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium whitespace-nowrap hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none data-[state=open]:bg-muted',
          filtered || dir ? 'text-primary' : 'text-muted-foreground',
          align === 'right' && 'flex-row-reverse',
        )}
      >
        <span className="relative">
          {t(spec.header)}
          {pending ? (
            <span
              data-testid="pending-review-dot"
              className="absolute -top-0.5 -right-2 size-1.5 rounded-full bg-primary ring-2 ring-background"
            />
          ) : null}
        </span>
        <span className={cn('flex items-center gap-0.5', pending && 'ml-1.5')}>
          {filtered ? <span aria-hidden className="size-1.5 rounded-full bg-primary" /> : null}
          {dir ? <SortIcon aria-hidden className="size-3.5" /> : null}
          <ChevronDown
            aria-hidden
            className="size-3.5 opacity-60 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
          />
        </span>
      </button>
    </PopoverTrigger>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {pending ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent>{t('orders.review.filterCount', { count: pending })}</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      <PopoverContent
        align={align === 'right' ? 'end' : 'start'}
        aria-label={t(spec.header)}
        className={cn('motion-reduce:animate-none', spec.filter.kind === 'date' ? 'w-72' : 'w-64')}
      >
        <ColumnMenuBody
          spec={spec}
          search={search}
          onChange={onChange}
          ctx={ctx}
          onDone={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
