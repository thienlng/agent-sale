import type { ProductDto } from '@agent-sales/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { House, CalendarDays, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useCan } from '@/lib/permissions';
import { formatVnd } from '@/lib/format';
import { useAccommodations } from '../api/lodging';
import { AccommodationForm } from './accommodation-form';

export function AccommodationList() {
  const { t } = useTranslation(),
    query = useAccommodations(),
    canManage = useCan('catalog.manage');
  const [editing, setEditing] = useState<ProductDto | null | undefined>(undefined);
  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('lodging.title')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('lodging.intro')}</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/app/stays">
              <CalendarDays />
              {t('lodging.requestsTitle')}
            </Link>
          </Button>
          {canManage && (
            <Button onClick={() => setEditing(null)}>
              <Plus />
              {t('lodging.newProperty')}
            </Button>
          )}
        </div>
      </div>
      {query.isPending && <p role="status">{t('lodging.loading')}</p>}
      {query.isError && (
        <div role="alert">
          <p>{t('lodging.loadError')}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t('lodging.retry')}
          </Button>
        </div>
      )}
      {query.data?.length === 0 && (
        <div className="rounded-xl border p-8 text-center">
          <House className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p>{t('lodging.emptyProperties')}</p>
        </div>
      )}
      {query.data?.map((p) => (
        <AccommodationCard
          key={p.id}
          product={p}
          onEdit={canManage ? () => setEditing(p) : undefined}
        />
      ))}
      <Dialog open={editing !== undefined} onOpenChange={(open) => !open && setEditing(undefined)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t(editing ? 'lodging.editProperty' : 'lodging.newProperty')}</DialogTitle>
            <DialogDescription>{t('lodging.intro')}</DialogDescription>
          </DialogHeader>
          {editing !== undefined && (
            <AccommodationForm
              key={editing?.id ?? 'new'}
              product={editing ?? undefined}
              onSaved={() => setEditing(undefined)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AccommodationCard({
  product: p,
  onEdit,
}: {
  product: ProductDto;
  onEdit?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const a = p.accommodation;
  if (!a) return null;
  return (
    <article className="min-w-0 overflow-hidden rounded-xl border bg-card">
      <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_minmax(240px,0.65fr)]">
        <div>
          <div className="flex items-start justify-between gap-3">
            <div>
              <Badge variant="secondary">{t('lodging.wholeProperty')}</Badge>
              <h2 className="mt-3 text-xl font-semibold">{p.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{p.code}</p>
            </div>
            {onEdit && (
              <Button variant="outline" size="sm" onClick={onEdit}>
                <Pencil />
                {t('lodging.editProperty')}
              </Button>
            )}
          </div>
          <p className="mt-4 whitespace-pre-wrap text-sm">{p.description}</p>
          <p className="mt-4 font-medium">
            {t('lodging.capacity', {
              adults: a.standardAdults,
              children: a.standardChildren,
              age: a.childAgeBelow,
            })}
          </p>
          <p className="mt-1 text-sm">
            {a.bedrooms} {t('lodging.bedrooms')}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {a.amenities.map((v) => (
              <Badge key={v} variant="outline">
                {v}
              </Badge>
            ))}
          </div>
        </div>
        <div className="rounded-xl bg-muted/40 p-4">
          <h3 className="font-semibold">{t('lodging.referenceRates')}</h3>
          <div className="mt-3 space-y-3">
            {a.rates.map((rate, i) => (
              <div className="flex flex-wrap justify-between gap-2 text-sm" key={i}>
                <span>{rate.days.map((day) => t(`lodging.days.${day}`)).join(', ')}</span>
                <strong>{formatVnd(rate.amount)}</strong>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            {t(a.rateBasis === 'night' ? 'lodging.nightBasis' : 'lodging.referenceOnly')}
          </p>
          <p className="mt-4 text-sm text-muted-foreground">{t('lodging.availabilityUnknown')}</p>
        </div>
      </div>
      <div className="grid gap-5 border-t p-5 md:grid-cols-2">
        <section>
          <h3 className="font-semibold">{t('lodging.roomLayout')}</h3>
          <dl className="mt-3 space-y-2 text-sm">
            {a.roomLayout.map((room, i) => (
              <div key={i}>
                <dt className="font-medium">{room.name}</dt>
                <dd className="text-muted-foreground">{room.beds}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section>
          <h3 className="font-semibold">{t('lodging.notes')}</h3>
          <dl className="mt-3 space-y-3 text-sm">
            {(
              [
                ['checkInOut', 'checkInOut'],
                ['depositPolicy', 'deposit'],
                ['cancellationPolicy', 'cancellation'],
                ['extraGuestPolicy', 'extraGuests'],
                ['holidayPolicy', 'holidays'],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <dt className="font-medium">{t(`lodging.${label}`)}</dt>
                <dd className="whitespace-pre-wrap text-muted-foreground">
                  {a[key] || t('lodging.unknown')}
                </dd>
              </div>
            ))}
          </dl>
          {a.notes && (
            <p className="mt-4 whitespace-pre-wrap text-sm text-muted-foreground">{a.notes}</p>
          )}
        </section>
      </div>
      {a.gallery.length > 0 && (
        <section className="border-t p-5">
          <h3 className="mb-4 font-semibold">
            {t('lodging.gallery')} · {a.gallery.length}
          </h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {a.gallery.map((photo, i) => (
              <a
                key={i}
                href={photo.url}
                target="_blank"
                rel="noreferrer"
                className="overflow-hidden rounded-lg border"
              >
                <img
                  src={photo.url}
                  alt={photo.caption}
                  loading="lazy"
                  className="aspect-[4/3] w-full object-cover"
                />
                <p className="p-2 text-xs">{photo.caption}</p>
              </a>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
