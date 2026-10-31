import { Columns3, Download, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';

import {
  activeFilterChips,
  clearAllFilters,
  type OrderFilterContext,
} from './order-column-filters';
import {
  ORDER_COLUMNS,
  resetOrderColumns,
  toggleOrderColumn,
  useVisibleOrderColumns,
} from './order-columns';
import { OrdersFilterSheet } from './orders-filter-sheet';
import type { OrdersSearch } from './orders-search';

/**
 * One row: the global search, a removable chip per filtered column (hidden columns included),
 * "Xoá lọc", then columns and export. Sorting and filtering live in the column headers (on
 * phones, in the "Lọc & sắp xếp" sheet).
 */
export function OrdersToolbar({
  search,
  onChange,
  ctx,
  onExport,
  exporting,
}: {
  search: OrdersSearch;
  onChange: (patch: Partial<OrdersSearch>) => void;
  ctx: OrderFilterContext;
  onExport: () => void;
  exporting: boolean;
}) {
  const { t } = useTranslation();
  const visible = new Set(useVisibleOrderColumns().map((c) => c.id));
  const [text, setText] = useState(search.q ?? '');

  // Follow the URL when it changes from outside (sidebar link, back button, "Xoá lọc") …
  const pushed = useRef(search.q ?? '');
  useEffect(() => {
    if ((search.q ?? '') !== pushed.current) {
      pushed.current = search.q ?? '';
      setText(search.q ?? '');
    }
  }, [search.q]);
  // … and push typing to it without a request per keystroke.
  useEffect(() => {
    const id = setTimeout(() => {
      if ((search.q ?? '') !== text) {
        pushed.current = text;
        onChange({ q: text || undefined });
      }
    }, 300);
    return () => clearTimeout(id);
  }, [text, search.q, onChange]);

  const chips = activeFilterChips(search, t, ctx);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-72">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('orders.search')}
          aria-label={t('orders.search')}
          className="h-9 pl-9"
        />
      </div>

      {chips.length ? (
        <ul aria-label={t('orders.filters.active')} className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <li
              key={c.key}
              className="inline-flex h-7 max-w-72 items-center gap-0.5 rounded-full border border-primary/30 bg-primary-soft pr-0.5 pl-2.5 text-xs text-accent-foreground"
            >
              <span className="truncate" title={c.label}>
                {c.label}
              </span>
              <button
                type="button"
                onClick={() => onChange(c.clear)}
                aria-label={t('orders.filters.remove', { name: c.label })}
                className="grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {chips.length || search.q ? (
        <Button
          variant="link"
          size="sm"
          className="h-7 px-1"
          onClick={() => onChange(clearAllFilters())}
        >
          {t('orders.filters.clear')}
        </Button>
      ) : null}

      <div className="ml-auto flex items-center gap-2">
        <OrdersFilterSheet search={search} onChange={onChange} ctx={ctx} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9">
              <Columns3 />
              <span className="hidden sm:inline">{t('orders.filters.columns')}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>{t('orders.filters.columns')}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {ORDER_COLUMNS.filter((c) => !c.fixed).map((c) => (
              <DropdownMenuCheckboxItem
                key={c.id}
                checked={visible.has(c.id)}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={() => toggleOrderColumn(c.id)}
              >
                {t(c.header)}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={resetOrderColumns}>
              {t('orders.filters.resetColumns')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" size="sm" className="h-9" onClick={onExport} disabled={exporting}>
          <Download />
          <span className="hidden sm:inline">
            {exporting ? t('orders.filters.exporting') : t('orders.filters.export')}
          </span>
        </Button>
      </div>
    </div>
  );
}
