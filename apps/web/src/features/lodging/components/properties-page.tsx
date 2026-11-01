import type { PropertySummary } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { CircleAlert, House, ImageOff, Plus, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/lib/permissions';
import { cn } from '@/lib/utils';

import { useLodgingCalendar } from '../api/calendar';
import { useProperties } from '../api/properties';
import { addDays, todayNight } from '../lib/format';
import { STATUS_STYLE } from './booking-status-badge';
import { PropertyCreateDialog } from './property-create-dialog';

const TODAY_STYLE: Record<PropertySummary['today'], string> = {
  free: 'border-border text-muted-foreground',
  partial: 'border-primary/30 text-primary-strong',
  hold: STATUS_STYLE.hold.className,
  occupied: STATUS_STYLE.confirmed.className,
  blocked: STATUS_STYLE.active.className,
};

/**
 * Rooms places the bot cannot offer yet: no room on sale, or a room without a price on
 * some weekday (read from the next 7 nights of the calendar).
 */
function useUnpricedRooms(properties: PropertySummary[] | undefined) {
  const ids = useMemo(
    () => (properties ?? []).filter((p) => p.sellMode === 'rooms').map((p) => p.id),
    [properties],
  );
  const today = todayNight();
  const calendar = useLodgingCalendar({
    from: ids.length ? today : '',
    to: addDays(today, 7),
    propertyIds: ids,
  });
  return useMemo(() => {
    const result = new Map<string, 'noActiveRooms' | 'missingRates'>();
    for (const p of properties ?? []) {
      if (p.sellMode !== 'rooms') continue;
      if (!p.units.some((u) => u.kind === 'room' && u.active)) result.set(p.id, 'noActiveRooms');
    }
    for (const cp of calendar.data?.properties ?? []) {
      if (result.has(cp.id)) continue;
      if (cp.rows.some((r) => r.prices.some((n) => n.sell === null)))
        result.set(cp.id, 'missingRates');
    }
    return result;
  }, [properties, calendar.data]);
}

/** "Căn": card grid of the places with today's state and a "Thêm căn" dialog. */
export function PropertiesPage() {
  const { t } = useTranslation();
  const properties = useProperties();
  const canManage = useCan('catalog.manage');
  const [creating, setCreating] = useState(false);
  const warnings = useUnpricedRooms(properties.data);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('lodging.propertiesTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('lodging.places.intro')}</p>
        </div>
        {canManage && (
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            {t('lodging.places.add')}
          </Button>
        )}
      </div>
      {properties.isPending ? (
        <div
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
          role="status"
          aria-label={t('lodging.loading')}
        >
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-64 rounded-xl" />
          ))}
        </div>
      ) : properties.isError ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription className="flex flex-wrap items-center gap-2">
            {t('lodging.loadError')}
            <Button size="xs" variant="outline" onClick={() => void properties.refetch()}>
              {t('lodging.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : properties.data.length === 0 ? (
        <div className="grid justify-items-center gap-2 rounded-lg border border-dashed px-4 py-10 text-center">
          <House className="size-6 text-muted-foreground" aria-hidden />
          <p className="font-medium">{t('lodging.places.empty')}</p>
          <p className="text-sm text-muted-foreground">{t('lodging.places.emptyHint')}</p>
          {canManage && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              {t('lodging.places.add')}
            </Button>
          )}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {properties.data.map((p) => (
            <li key={p.id} className="min-w-0">
              <PropertyCard property={p} warning={warnings.get(p.id)} />
            </li>
          ))}
        </ul>
      )}
      {creating && <PropertyCreateDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function PropertyCard({
  property: p,
  warning,
}: {
  property: PropertySummary;
  warning: 'noActiveRooms' | 'missingRates' | undefined;
}) {
  const { t } = useTranslation();
  const cover = p.gallery[0];
  const titleId = `property-${p.id}-title`;
  const rooms = p.units.filter((u) => u.kind === 'room' && u.active).length;
  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        'relative flex h-full min-w-0 flex-col overflow-hidden rounded-xl border bg-card transition-colors hover:border-primary/40 focus-within:ring-2 focus-within:ring-ring',
        p.status === 'paused' && 'opacity-70',
      )}
    >
      <div className="aspect-[16/9] bg-muted">
        {cover ? (
          <img
            src={cover.url}
            alt={cover.caption}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="size-full object-cover"
          />
        ) : (
          <div className="grid size-full place-items-center text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <ImageOff className="size-4" aria-hidden />
              {t('lodging.places.noPhoto')}
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <h2 id={titleId} className="min-w-0 text-sm">
          <Link
            to="/app/properties/$propertyId"
            params={{ propertyId: p.id }}
            className="outline-none after:absolute after:inset-0"
          >
            <span className="font-semibold tabular-nums">{p.code}</span>
            <span className="text-muted-foreground"> · </span>
            <span className="break-words">{p.name}</span>
          </Link>
        </h2>
        {p.area && <p className="text-xs text-muted-foreground">{p.area}</p>}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <Badge variant="secondary">{t(`lodging.sellMode.${p.sellMode}`)}</Badge>
          <span className="tabular-nums text-muted-foreground">
            {t('lodging.cal.capacity', { adults: p.standardAdults, children: p.standardChildren })}
          </span>
          {p.sellMode === 'rooms' && (
            <span className="tabular-nums text-muted-foreground">
              · {t('lodging.cal.rooms', { count: rooms })}
            </span>
          )}
        </div>
        <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
          {p.status === 'paused' ? (
            <Badge variant="outline">{t('lodging.places.paused')}</Badge>
          ) : (
            <Badge variant="outline" className={TODAY_STYLE[p.today]}>
              {t(`lodging.places.today.${p.today}`)}
            </Badge>
          )}
        </div>
        {warning && (
          <p className="flex items-start gap-1.5 rounded-md bg-warning/10 p-2 text-xs text-warning">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              {t(`lodging.places.${warning}`)} {t('lodging.places.botHidden')}
            </span>
          </p>
        )}
      </div>
    </article>
  );
}
