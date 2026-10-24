import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type { OrdersSearch } from './orders-search';

const PAGE_SIZES = [20, 50, 100] as const;

/** Page numbers to show: first, last, current ± 1, with gaps as null. */
function pageList(page: number, pages: number): Array<number | null> {
  const wanted = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const sorted = [...wanted].sort((a, b) => a - b);
  return sorted.flatMap((p, i) => (i > 0 && p - (sorted[i - 1] ?? p) > 1 ? [null, p] : [p]));
}

/** Range info, page size and numbered pages. */
export function Pager({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (patch: Partial<OrdersSearch>) => void;
}) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span>
          {t('orders.pageInfo', {
            from: (page - 1) * pageSize + 1,
            to: Math.min(page * pageSize, total),
            total,
          })}
        </span>
        <Select value={String(pageSize)} onValueChange={(v) => onChange({ pageSize: Number(v) })}>
          <SelectTrigger size="sm" className="w-28" aria-label={t('orders.perPageLabel')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {t('orders.perPage', { count: n })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {pages > 1 ? (
        <nav className="flex items-center gap-1" aria-label={t('orders.pagination')}>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={page <= 1}
            onClick={() => onChange({ page: page - 1 })}
            aria-label={t('orders.prevPage')}
          >
            <ChevronLeft />
          </Button>
          {pageList(page, pages).map((p, i) =>
            p === null ? (
              <span key={`gap-${i}`} className="px-1 text-muted-foreground">
                …
              </span>
            ) : (
              <Button
                key={p}
                variant={p === page ? 'outline' : 'ghost'}
                size="icon-sm"
                aria-current={p === page ? 'page' : undefined}
                onClick={() => onChange({ page: p })}
                className="tabular-nums"
              >
                {p}
              </Button>
            ),
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={page >= pages}
            onClick={() => onChange({ page: page + 1 })}
            aria-label={t('orders.nextPage')}
          >
            <ChevronRight />
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
