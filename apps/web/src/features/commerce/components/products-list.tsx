import type { OfferingDetails } from '@agent-sales/contracts';
import { Link, useNavigate } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { ChevronLeft, ChevronRight, Package, Plus, RefreshCw, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
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
import { formatNumber, formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useCan } from '@/lib/permissions';

import { useProducts } from '../api/commerce';
import { usePmsHintDismissed } from '../hooks/pms-hint';
import { catalogKey } from './product-offering-editor';
import { priceLabel } from './product-price';

/** The workspace's live KiotViet connection, as the route reads it from the integration feature. */
export interface PmsLink {
  retailer: string;
  lastSyncAt: string | null;
}

type Source = 'all' | 'kiotviet' | 'rapiz';

/** A small toggle group; 44 px tall on touch screens, compact from `md`. */
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label?: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex rounded-lg border p-0.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'min-h-10 rounded-md px-3 py-1 text-sm md:min-h-0',
            value === o.value
              ? 'bg-primary-soft font-medium text-accent-foreground'
              : 'text-muted-foreground hover:bg-muted',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A course or service has no stock: its length and sessions take the stock cell ("60 phút · 10 buổi"). */
function offeringLength(o: OfferingDetails, t: TFunction): string {
  const parts = [
    o.durationMinutes ? t('commerce.offering.minutesCount', { count: o.durationMinutes }) : '',
    o.sessions ? t('commerce.offering.sessionsCount', { count: o.sessions }) : '',
    o.durationMinutes || o.sessions ? '' : o.period,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : '—';
}

/** Not connected: a dismissible card that points to the PMS integrations hub. */
function PmsHint({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2 rounded-xl border bg-primary-soft/40 p-3 pl-4">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
        <p className="min-w-0 flex-1 basis-56 py-1.5 text-sm font-medium">
          {t('products.pmsHint')}
        </p>
        <Button variant="outline" className="h-11 md:h-9" asChild>
          <Link to="/app/integrations">{t('products.pmsHintAction')}</Link>
        </Button>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-11 shrink-0 md:size-9"
        aria-label={t('products.pmsHintDismiss')}
        onClick={onDismiss}
      >
        <X />
      </Button>
    </div>
  );
}

/**
 * Product catalog (ORD-01): search, on-sale/archived, price range, stock available. With
 * `pmsLink` (KiotViet connected) it shows the sync bar and a source filter; with `null` (not
 * connected) it offers the integration; `undefined` (unknown yet) shows neither. `offeringKind`
 * (an education or spa business) names the page for what it sells, like the sidebar.
 */
export function ProductsList({
  pmsLink,
  offeringKind,
}: {
  pmsLink?: PmsLink | null | undefined;
  offeringKind?: 'course' | 'service' | null | undefined;
}) {
  const { t } = useTranslation();
  const title = offeringKind ? t('nav.services') : t('products.title');
  /** A catalog word, named for the courses or services of an education or spa business. */
  const word = (key: string, fallback: string) => t(catalogKey(offeringKind, key, fallback));
  const navigate = useNavigate();
  const canAdd = useCan('catalog.manage');
  const [hintDismissed, dismissHint] = usePmsHintDismissed();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [source, setSource] = useState<Source>('all');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const id = setTimeout(() => {
      setQ(text.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [text]);
  const products = useProducts({
    ...(q ? { q } : {}),
    status,
    page,
    ...(pmsLink && source !== 'all' ? { source } : {}),
  });
  const data = products.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const anyOffering = data?.data.some((p) => p.offering) ?? false;

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {canAdd ? (
          <Button size="lg" asChild data-assistant-target="products.new">
            <Link to="/app/products/new">
              <Plus />
              {word('add', 'products.add')}
            </Link>
          </Button>
        ) : null}
      </header>

      {pmsLink ? (
        <Link
          to="/app/integrations/kiotviet"
          className="-my-2 inline-flex min-h-11 w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="size-4 text-primary" aria-hidden />
          {pmsLink.lastSyncAt
            ? t('products.pmsBar', { time: formatRelativeTime(pmsLink.lastSyncAt) })
            : t('products.pmsBarPending')}
        </Link>
      ) : pmsLink === null && canAdd && !hintDismissed ? (
        <PmsHint onDismiss={dismissHint} />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={word('search', 'products.search')}
            aria-label={word('search', 'products.search')}
            className="h-9 pl-9"
          />
        </div>
        <Segmented
          options={(['active', 'archived'] as const).map((s) => ({
            value: s,
            label: t(`products.${s}`),
          }))}
          value={status}
          onChange={(s) => {
            setStatus(s);
            setPage(1);
          }}
        />
        {pmsLink ? (
          <Segmented
            label={t('products.source')}
            options={[
              { value: 'all', label: t('products.sourceAll') },
              { value: 'kiotviet', label: t('products.sourceKiotviet') },
              { value: 'rapiz', label: t('products.sourceRapiz') },
            ]}
            value={source}
            onChange={(s: Source) => {
              setSource(s);
              setPage(1);
            }}
          />
        ) : null}
      </div>

      <div className="overflow-hidden rounded-xl border">
        <div className="overflow-x-auto">
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>{t('products.col.code')}</TableHead>
                <TableHead>{word('colName', 'products.col.name')}</TableHead>
                <TableHead>{t('products.col.variants')}</TableHead>
                <TableHead className="text-right">{t('products.col.price')}</TableHead>
                <TableHead className="text-right">
                  {anyOffering
                    ? `${t('products.col.available')} / ${t('commerce.offering.col')}`
                    : t('products.col.available')}
                </TableHead>
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
                      <TableCell className="max-w-80">
                        <span className="flex items-center gap-2">
                          <span className="truncate">{p.name}</span>
                          {p.external ? (
                            <Badge variant="outline">{t('products.sourceKiotviet')}</Badge>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {t('products.variantsCount', { count: p.variants.length })}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {priceLabel(p, Boolean(offeringKind), t)}
                      </TableCell>
                      {p.offering || offeringKind ? (
                        <TableCell className="text-right text-muted-foreground tabular-nums">
                          {p.offering ? offeringLength(p.offering, t) : '—'}
                        </TableCell>
                      ) : (
                        <TableCell
                          className={cn(
                            'text-right tabular-nums',
                            p.available <= 0 && 'text-destructive',
                          )}
                        >
                          {formatNumber(p.available)}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
              {data && !data.data.length ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="py-14 text-center text-muted-foreground">
                    <Package className="mx-auto mb-3 size-8 text-primary" aria-hidden />
                    {q || status === 'archived' || (pmsLink && source !== 'all')
                      ? word('empty', 'products.empty')
                      : word('emptyStart', 'products.emptyStart')}
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
