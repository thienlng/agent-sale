import type { PropertySummary } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { ImageOff, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

import { formatShortVnd, formatVnd } from '../lib/format';

export type PropertyWarning = 'noActiveRooms' | 'missingRates';

/** Weekday groups of the price columns: ISO weekday indexes (0 = Monday). */
const PRICE_COLUMNS = [
  { key: 'monThu', days: [0, 1, 2, 3] },
  { key: 'fri', days: [4] },
  { key: 'sat', days: [5] },
] as const;

/** One price, or the min–max range when the weekdays of a group differ. */
function PriceCell({ prices, days }: { prices: (number | null)[]; days: readonly number[] }) {
  const { t } = useTranslation();
  const values = days.map((d) => prices[d] ?? null);
  if (values.some((v) => v === null))
    return <span className="text-muted-foreground">{t('lodging.places.noPrice')}</span>;
  const numbers = values as number[];
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const full = min === max ? formatVnd(min) : `${formatVnd(min)} – ${formatVnd(max)}`;
  return (
    <span className="tabular-nums" title={full}>
      {min === max ? formatShortVnd(min) : `${formatShortVnd(min)}–${formatShortVnd(max)}`}
    </span>
  );
}

/** "Danh sách": a compact row per place; the table scrolls inside its container on phones. */
export function PropertiesTable({
  properties,
  warnings,
  todayStyle,
}: {
  properties: PropertySummary[];
  warnings: Map<string, PropertyWarning>;
  todayStyle: Record<PropertySummary['today'], string>;
}) {
  const { t } = useTranslation();
  return (
    <div className="min-w-0 rounded-xl border bg-card">
      <Table className="min-w-[56rem]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">{t('lodging.places.col.photo')}</TableHead>
            <TableHead>{t('lodging.places.col.code')}</TableHead>
            <TableHead>{t('lodging.places.col.name')}</TableHead>
            <TableHead>{t('lodging.places.col.area')}</TableHead>
            <TableHead>{t('lodging.places.col.sellMode')}</TableHead>
            <TableHead>{t('lodging.places.col.standard')}</TableHead>
            {PRICE_COLUMNS.map((c) => (
              <TableHead key={c.key} className="text-right">
                {t(`lodging.places.col.${c.key}`)}
              </TableHead>
            ))}
            <TableHead>{t('lodging.places.col.today')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {properties.map((p) => {
            const cover = p.gallery[0];
            const warning = warnings.get(p.id);
            return (
              <TableRow
                key={p.id}
                aria-label={`${p.code} · ${p.name}`}
                className={cn(p.status === 'paused' && 'opacity-70')}
              >
                <TableCell>
                  <div className="relative size-10 shrink-0 overflow-hidden rounded-md bg-muted">
                    {cover ? (
                      <img
                        src={cover.url}
                        alt={cover.caption}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="absolute inset-0 size-full object-cover"
                      />
                    ) : (
                      <span className="grid size-full place-items-center text-muted-foreground">
                        <ImageOff className="size-4" aria-hidden />
                        <span className="sr-only">{t('lodging.places.noPhoto')}</span>
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="font-semibold tabular-nums">{p.code}</TableCell>
                <TableCell className="max-w-64 whitespace-normal">
                  <span className="flex items-start gap-1.5">
                    <Link
                      to="/app/properties/$propertyId"
                      params={{ propertyId: p.id }}
                      className="break-words font-medium hover:underline"
                    >
                      {p.name}
                    </Link>
                    {warning && (
                      <span className="text-warning" title={t(`lodging.places.${warning}`)}>
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                        <span className="sr-only">
                          {t(`lodging.places.${warning}`)} {t('lodging.places.botHidden')}
                        </span>
                      </span>
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">{p.area}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{t(`lodging.sellMode.${p.sellMode}`)}</Badge>
                </TableCell>
                <TableCell className="tabular-nums text-muted-foreground">
                  {t('lodging.cal.capacity', {
                    adults: p.standardAdults,
                    children: p.standardChildren,
                  })}
                </TableCell>
                {PRICE_COLUMNS.map((c) => (
                  <TableCell key={c.key} className="text-right">
                    <PriceCell prices={p.weekdaySell} days={c.days} />
                  </TableCell>
                ))}
                <TableCell>
                  {p.status === 'paused' ? (
                    <Badge variant="outline">{t('lodging.places.paused')}</Badge>
                  ) : (
                    <Badge variant="outline" className={todayStyle[p.today]}>
                      {t(`lodging.places.today.${p.today}`)}
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
