import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

import {
  columnSortDir,
  filterValueLabel,
  isColumnFiltered,
  ORDER_COLUMN_MENUS,
  type OrderFilterContext,
} from './order-column-filters';
import { ColumnMenuBody } from './order-column-menu';
import type { OrdersSearch } from './orders-search';

/**
 * Phones (below `md`) show cards without headers: the same column menus live in a sheet, one
 * collapsible section per column.
 */
export function OrdersFilterSheet({
  search,
  onChange,
  ctx,
}: {
  search: OrdersSearch;
  onChange: (patch: Partial<OrdersSearch>) => void;
  ctx: OrderFilterContext;
}) {
  const { t } = useTranslation();
  const [section, setSection] = useState<string | null>(null);
  const active = ORDER_COLUMN_MENUS.filter((m) => isColumnFiltered(m, search)).length;

  return (
    <Sheet onOpenChange={() => setSection(null)}>
      <SheetTrigger asChild>
        <Button variant="outline" size="lg" className="h-9 md:hidden">
          <SlidersHorizontal />
          {t('orders.columnMenu.mobile')}
          {active ? (
            <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground tabular-nums">
              <span aria-hidden>{formatNumber(active)}</span>
              <span className="sr-only">
                {t('orders.columnMenu.activeCount', { count: active })}
              </span>
            </span>
          ) : null}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85dvh] gap-0 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t('orders.columnMenu.mobile')}</SheetTitle>
          <SheetDescription>{t('orders.columnMenu.mobileHint')}</SheetDescription>
        </SheetHeader>
        <ul className="flex flex-col px-4 pb-4">
          {ORDER_COLUMN_MENUS.map((m) => {
            const filtered = isColumnFiltered(m, search);
            const dir = columnSortDir(m, search);
            const open = section === m.id;
            return (
              <li key={m.id} className="border-b last:border-b-0">
                <Collapsible open={open} onOpenChange={(o) => setSection(o ? m.id : null)}>
                  <CollapsibleTrigger className="flex min-h-11 w-full items-center gap-2 text-left text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                    <span className={cn('font-medium', filtered && 'text-primary')}>
                      {t(m.header)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">
                      {filtered ? filterValueLabel(m, search, t, ctx) : null}
                      {dir && search.sort
                        ? ` ${t(dir === 'asc' ? 'orders.columnMenu.stateAsc' : 'orders.columnMenu.stateDesc')}`
                        : null}
                    </span>
                    <ChevronDown
                      aria-hidden
                      className={cn(
                        'size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
                        open && 'rotate-180',
                      )}
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pb-3">
                    <ColumnMenuBody
                      spec={m}
                      search={search}
                      onChange={onChange}
                      ctx={ctx}
                      onDone={() => setSection(null)}
                    />
                  </CollapsibleContent>
                </Collapsible>
              </li>
            );
          })}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
