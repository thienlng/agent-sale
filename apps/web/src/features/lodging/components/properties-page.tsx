import { galleryCoverUrl, type PropertySummary } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { CircleAlert, House, ImageOff, LayoutGrid, List, Plus, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useCan } from '@/lib/permissions';
import { cn } from '@/lib/utils';

import { useLodgingCalendar } from '../api/calendar';
import { useProperties } from '../api/properties';
import { usePropertiesView } from '../hooks/use-properties-view';
import { addDays, todayNight } from '../lib/format';
import { STATUS_STYLE } from './booking-status-badge';
import { PropertiesTable, type PropertyWarning } from './properties-table';
import { PropertyCreateDialog } from './property-create-dialog';
import { CoverImage } from './cover-image';

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
    const result = new Map<string, PropertyWarning>();
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

/**
 * "Căn hộ": the places as a card grid ("Thẻ") or a compact table ("Danh sách", remembered per
 * user), with today's state and a "Thêm căn hộ" dialog.
 */
export function PropertiesPage() {
  const { t } = useTranslation('lodging');
  const properties = useProperties();
  const canManage = useCan('catalog.manage');
  const [creating, setCreating] = useState(false);
  const warnings = useUnpricedRooms(properties.data);
  const [view, setView] = usePropertiesView();

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('propertiesTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('places.intro')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            aria-label={t('places.view')}
            value={view}
            onValueChange={(v) => (v === 'cards' || v === 'list') && setView(v)}
          >
            <ToggleGroupItem value="cards" aria-label={t('places.viewCards')}>
              <LayoutGrid aria-hidden />
              <span className="max-sm:sr-only">{t('places.viewCards')}</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label={t('places.viewList')}>
              <List aria-hidden />
              <span className="max-sm:sr-only">{t('places.viewList')}</span>
            </ToggleGroupItem>
          </ToggleGroup>
          {canManage && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              {t('places.add')}
            </Button>
          )}
        </div>
      </div>
      {properties.isPending ? (
        <div
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
          role="status"
          aria-label={t('loading')}
        >
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-64 rounded-xl" />
          ))}
        </div>
      ) : properties.isError ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription className="flex flex-wrap items-center gap-2">
            {t('loadError')}
            <Button size="xs" variant="outline" onClick={() => void properties.refetch()}>
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : properties.data.length === 0 ? (
        <div className="grid justify-items-center gap-2 rounded-lg border border-dashed px-4 py-10 text-center">
          <House className="size-6 text-muted-foreground" aria-hidden />
          <p className="font-medium">{t('places.empty')}</p>
          <p className="text-sm text-muted-foreground">{t('places.emptyHint')}</p>
          {canManage && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              {t('places.add')}
            </Button>
          )}
        </div>
      ) : view === 'list' ? (
        <PropertiesTable
          properties={properties.data}
          warnings={warnings}
          todayStyle={TODAY_STYLE}
        />
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
  warning: PropertyWarning | undefined;
}) {
  const { t } = useTranslation('lodging');
  const cover = galleryCoverUrl(p);
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
      {/* Fixed 4:3 crop; the absolute image cannot stretch the box (aspect-ratio min-height). */}
      <div className="relative aspect-[4/3] shrink-0 overflow-hidden bg-muted">
        {cover ? (
          <CoverImage src={cover} alt={p.name} />
        ) : (
          <div className="grid size-full place-items-center text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <ImageOff className="size-4" aria-hidden />
              {t('places.noPhoto')}
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
        {p.address && <p className="text-xs text-muted-foreground">{p.address}</p>}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <Badge variant="secondary">{t(`sellMode.${p.sellMode}`)}</Badge>
          <span className="tabular-nums text-muted-foreground">
            {t('cal.capacity', { adults: p.standardAdults, children: p.standardChildren })}
          </span>
          {p.sellMode === 'rooms' && (
            <span className="tabular-nums text-muted-foreground">
              · {t('cal.rooms', { count: rooms })}
            </span>
          )}
        </div>
        {warning && (
          <p className="flex items-start gap-1.5 rounded-md bg-warning/10 p-2 text-xs text-warning">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>{t(`places.${warning}`)}</span>
          </p>
        )}
        {/* Pinned to the bottom, so the status badges line up across a row of cards. */}
        <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
          {p.status === 'paused' ? (
            <Badge variant="outline">{t('places.paused')}</Badge>
          ) : (
            <Badge variant="outline" className={TODAY_STYLE[p.today]}>
              {t(`places.today.${p.today}`)}
            </Badge>
          )}
        </div>
      </div>
    </article>
  );
}
