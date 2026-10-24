import type { ProductDto } from '@agent-sales/contracts';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Package,
  PackageOpen,
  Plus,
  Search,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime, formatVnd } from '@/lib/format';

import { useProducts } from '../api/commerce';
import { downloadCsv, formatProductsCsv } from './bot-products-csv';

const PAGE_SIZES = [10, 20, 50] as const;

function ProductRow({ product, index }: { product: ProductDto; index: number }) {
  const navigate = useNavigate();
  return (
    <TableRow
      className="cursor-pointer"
      onClick={() =>
        void navigate({ to: '/app/products/$productId', params: { productId: product.id } })
      }
    >
      <TableCell className="text-center text-xs text-muted-foreground tabular-nums">
        {index}
      </TableCell>
      <TableCell className="whitespace-normal">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted">
            <Package className="size-5 text-muted-foreground" aria-hidden />
          </span>
          <span className="min-w-0">
            <Link
              to="/app/products/$productId"
              params={{ productId: product.id }}
              className="line-clamp-2 font-medium break-words hover:text-primary"
              onClick={(e) => e.stopPropagation()}
            >
              {product.name}
            </Link>
            <span className="block text-xs text-muted-foreground">{product.code}</span>
          </span>
        </div>
      </TableCell>
      <TableCell className="tabular-nums">
        {product.priceMin === product.priceMax
          ? formatVnd(product.priceMin)
          : `${formatVnd(product.priceMin)} – ${formatVnd(product.priceMax)}`}
      </TableCell>
      <TableCell className="whitespace-normal text-sm text-muted-foreground">
        <span className="line-clamp-2 break-words">{product.description || '—'}</span>
      </TableCell>
      <TableCell className="text-right text-sm text-muted-foreground tabular-nums">
        {formatDateTime(product.updatedAt)}
      </TableCell>
    </TableRow>
  );
}

/** Bot "Sản phẩm" page body: search, CSV download, add menu, table and pagination. */
export function BotProductsTable() {
  const { t } = useTranslation('training');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(10);
  useEffect(() => {
    const id = setTimeout(() => {
      setQ(text.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [text]);
  const products = useProducts({ ...(q ? { q } : {}), status: 'active', page, pageSize });
  const data = products.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const rows = data?.data ?? [];

  const exportCsv = () =>
    downloadCsv(
      formatProductsCsv(rows, {
        code: t('data.products.colCode'),
        name: t('data.products.colProduct'),
        priceMin: `${t('data.products.colPrice')} min`,
        priceMax: `${t('data.products.colPrice')} max`,
        description: t('data.products.colDescription'),
        updatedAt: t('data.products.colUpdated'),
      }),
      `products-${new Date().toISOString().slice(0, 10)}.csv`,
    );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-80">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('data.products.search')}
            aria-label={t('data.products.search')}
            className="h-9 pl-9"
          />
        </div>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="icon-lg"
            disabled={!rows.length}
            aria-label={t('data.products.exportCsv')}
            title={t('data.products.exportCsv')}
            onClick={exportCsv}
          >
            <Download />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="h-9">
                <Plus />
                {t('data.products.add')}
                <ChevronDown aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to="/app/products/new">{t('data.addManual')}</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border">
        <div className="overflow-x-auto">
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted [&>th]:font-medium [&>th]:text-primary">
                <TableHead className="w-14 text-center">{t('data.products.colIndex')}</TableHead>
                <TableHead>{t('data.products.colProduct')}</TableHead>
                <TableHead className="w-44">{t('data.products.colPrice')}</TableHead>
                <TableHead>{t('data.products.colDescription')}</TableHead>
                <TableHead className="w-40 text-right">{t('data.products.colUpdated')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.isPending
                ? Array.from({ length: 4 }, (_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={5}>
                        <Skeleton className="h-10" />
                      </TableCell>
                    </TableRow>
                  ))
                : rows.map((p, i) => (
                    <ProductRow
                      key={p.id}
                      product={p}
                      index={(data ? (data.page - 1) * data.pageSize : 0) + i + 1}
                    />
                  ))}
              {products.isError || (data && !rows.length) ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="py-14 text-center">
                    <span className="mx-auto mb-3 flex size-16 items-center justify-center rounded-2xl bg-primary-soft">
                      <PackageOpen className="size-8 text-primary" aria-hidden />
                    </span>
                    {products.isError ? (
                      <span role="alert">
                        {t('data.error')}{' '}
                        <Button variant="link" onClick={() => void products.refetch()}>
                          {t('data.retry')}
                        </Button>
                      </span>
                    ) : (
                      t('data.products.empty')
                    )}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-muted-foreground">
          {t('data.products.total', { count: data?.total ?? 0 })}
        </p>
        <Select
          value={String(pageSize)}
          onValueChange={(value) => {
            setPageSize(Number(value));
            setPage(1);
          }}
        >
          <SelectTrigger aria-label={t('data.pageSize')} className="h-9 w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
          aria-label={t('data.previous')}
        >
          <ChevronLeft />
        </Button>
        <span
          className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground tabular-nums"
          aria-label={t('data.currentPage', { page, pages })}
        >
          {page}
        </span>
        <Button
          variant="ghost"
          size="icon"
          disabled={page >= pages}
          onClick={() => setPage(page + 1)}
          aria-label={t('data.next')}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
