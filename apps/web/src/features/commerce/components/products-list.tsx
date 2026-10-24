import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Package, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatNumber, formatVnd } from '@/lib/format';
import { cn } from '@/lib/utils';

import { useProducts } from '../api/commerce';

/** Product catalog (ORD-01): search, on-sale/archived, price range, stock available. */
export function ProductsList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const id = setTimeout(() => {
      setQ(text.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [text]);
  const products = useProducts({ ...(q ? { q } : {}), status, page });
  const data = products.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('products.title')}</h1>
        <Button size="lg" asChild>
          <Link to="/app/products/new">
            <Plus />
            {t('products.add')}
          </Link>
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('products.search')}
            aria-label={t('products.search')}
            className="h-9 pl-9"
          />
        </div>
        <div className="flex rounded-lg border p-0.5" role="group">
          {(['active', 'archived'] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={status === s}
              onClick={() => {
                setStatus(s);
                setPage(1);
              }}
              className={cn(
                'rounded-md px-3 py-1 text-sm',
                status === s
                  ? 'bg-primary-soft font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {t(`products.${s}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border">
        <div className="overflow-x-auto">
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>{t('products.col.code')}</TableHead>
                <TableHead>{t('products.col.name')}</TableHead>
                <TableHead>{t('products.col.variants')}</TableHead>
                <TableHead className="text-right">{t('products.col.price')}</TableHead>
                <TableHead className="text-right">{t('products.col.available')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.isPending
                ? Array.from({ length: 5 }, (_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={5}>
                        <Skeleton className="h-8" />
                      </TableCell>
                    </TableRow>
                  ))
                : data?.data.map((p) => (
                    <TableRow
                      key={p.id}
                      className="cursor-pointer"
                      onClick={() =>
                        void navigate({
                          to: '/app/products/$productId',
                          params: { productId: p.id },
                        })
                      }
                    >
                      <TableCell className="font-medium tabular-nums">
                        <Link
                          to="/app/products/$productId"
                          params={{ productId: p.id }}
                          className="text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {p.code}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-80 truncate">{p.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {t('products.variantsCount', { count: p.variants.length })}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.priceMin === p.priceMax
                          ? formatVnd(p.priceMin)
                          : `${formatVnd(p.priceMin)} – ${formatVnd(p.priceMax)}`}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right tabular-nums',
                          p.available <= 0 && 'text-destructive',
                        )}
                      >
                        {formatNumber(p.available)}
                      </TableCell>
                    </TableRow>
                  ))}
              {data && !data.data.length ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="py-14 text-center text-muted-foreground">
                    <Package className="mx-auto mb-3 size-8 text-primary" aria-hidden />
                    {q || status === 'archived' ? t('products.empty') : t('products.emptyStart')}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </div>

      {data && data.total > data.pageSize ? (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            aria-label={t('orders.prevPage')}
          >
            <ChevronLeft />
          </Button>
          <span className="text-sm text-muted-foreground tabular-nums">
            {page} / {pages}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
            aria-label={t('orders.nextPage')}
          >
            <ChevronRight />
          </Button>
        </div>
      ) : null}
    </section>
  );
}
