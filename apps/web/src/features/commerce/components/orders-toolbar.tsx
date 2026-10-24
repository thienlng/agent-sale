import { OrderSource, type OrderStatus } from '@agent-sales/contracts';
import { ChevronDown, Columns3, Download, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DateRangePicker } from '@/components/date-range-picker';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatDate, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

import {
  ORDER_COLUMNS,
  resetOrderColumns,
  toggleOrderColumn,
  useVisibleOrderColumns,
} from './order-columns';
import type { OrdersSearch } from './orders-search';

const ALL = '__all';
const SORTS = ['placed_desc', 'placed_asc', 'total_desc', 'total_asc'] as const;

/** Search, filters (status with counts, source, dates), sort, columns and export, in one row. */
export function OrdersToolbar({
  search,
  onChange,
  statuses,
  counts,
  onExport,
  exporting,
}: {
  search: OrdersSearch;
  onChange: (patch: Partial<OrdersSearch>) => void;
  statuses: readonly OrderStatus[];
  counts: Record<string, number>;
  onExport: () => void;
  exporting: boolean;
}) {
  const { t } = useTranslation();
  const visible = new Set(useVisibleOrderColumns().map((c) => c.id));
  const [text, setText] = useState(search.q ?? '');

  // Follow the URL when it changes from outside (sidebar link, back button) …
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

  const chips: Array<{ key: string; label: string; clear: Partial<OrdersSearch> }> = [];
  if (search.status)
    chips.push({
      key: 'status',
      label: t(`status.${search.status}`),
      clear: { status: undefined },
    });
  if (search.source)
    chips.push({
      key: 'source',
      label: t(`source.${search.source}`),
      clear: { source: undefined },
    });
  if (search.from && search.to) {
    chips.push({
      key: 'date',
      label:
        search.from === search.to
          ? formatDate(search.from)
          : `${formatDate(search.from)} – ${formatDate(search.to)}`,
      clear: { from: undefined, to: undefined },
    });
  }
  if (search.q) chips.push({ key: 'q', label: `“${search.q}”`, clear: { q: undefined } });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
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

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="h-9 justify-between gap-2 font-normal">
              <span className="text-muted-foreground">{t('orders.filters.status')}:</span>
              <span className="font-medium">
                {search.status ? t(`status.${search.status}`) : t('orders.filters.allStatuses')}
              </span>
              <ChevronDown className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuRadioGroup
              value={search.status ?? ALL}
              onValueChange={(v) =>
                onChange({ status: v === ALL ? undefined : (v as OrderStatus) })
              }
            >
              <DropdownMenuRadioItem value={ALL}>
                {t('orders.filters.allStatuses')}
                <span className="ml-auto text-muted-foreground tabular-nums">
                  {formatNumber(counts['all'] ?? 0)}
                </span>
              </DropdownMenuRadioItem>
              <DropdownMenuSeparator />
              {statuses.map((s) => (
                <DropdownMenuRadioItem key={s} value={s}>
                  {t(`status.${s}`)}
                  <span
                    className={cn(
                      'ml-auto tabular-nums',
                      counts[s] ? 'font-medium' : 'text-muted-foreground',
                    )}
                  >
                    {formatNumber(counts[s] ?? 0)}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <Select
          value={search.source ?? ALL}
          onValueChange={(v) => onChange({ source: v === ALL ? undefined : (v as OrderSource) })}
        >
          <SelectTrigger className="h-9 w-36" aria-label={t('orders.source')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('orders.allSources')}</SelectItem>
            <SelectSeparator />
            {OrderSource.options.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`source.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DateRangePicker
          allowClear
          value={search.from && search.to ? { from: search.from, to: search.to } : null}
          onChange={(r) => onChange({ from: r?.from, to: r?.to })}
        />

        <Select
          value={search.sort ?? 'placed_desc'}
          onValueChange={(v) => onChange({ sort: v as OrdersSearch['sort'] })}
        >
          <SelectTrigger className="h-9 w-40" aria-label={t('orders.filters.sort')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`orders.sort.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2">
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
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            onClick={onExport}
            disabled={exporting}
          >
            <Download />
            <span className="hidden sm:inline">
              {exporting ? t('orders.filters.exporting') : t('orders.filters.export')}
            </span>
          </Button>
        </div>
      </div>

      {chips.length ? (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <span
              key={c.key}
              className="inline-flex items-center gap-1 rounded-full bg-secondary py-0.5 pr-1 pl-2.5 text-sm"
            >
              {c.label}
              <button
                type="button"
                onClick={() => onChange(c.clear)}
                aria-label={t('orders.filters.remove', { name: c.label })}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </span>
          ))}
          <Button
            variant="link"
            size="sm"
            className="h-auto px-1"
            onClick={() =>
              onChange({
                status: undefined,
                source: undefined,
                from: undefined,
                to: undefined,
                q: undefined,
              })
            }
          >
            {t('orders.filters.clear')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
