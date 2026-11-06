import type { PropertyDto, UnitDto } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { ChevronLeft, CircleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiClientError } from '@/lib/api-client';
import { useCan } from '@/lib/permissions';

import { useProperty, useReplaceUnits } from '../api/properties';
import { useSaveError } from '../hooks/use-save-error';
import type { GalleryImageUpload } from '../lib/gallery-model';
import { unitsWith } from '../lib/units-model';
import { LeaveGuard, UnsavedMark, useDirtyTabs } from './editor-shell';
import { GalleryForm, galleryDraftOf, type GallerySave } from './gallery-tab';
import { RatesTab } from './rates-tab';
import { partyLine } from './rooms-tab';
import { UnitInfoTab } from './unit-info-tab';

type TabKey = 'info' | 'rates' | 'gallery';
const TABS: TabKey[] = ['info', 'rates', 'gallery'];

/**
 * Unit page (`/app/properties/{id}/units/{unitId}`, T-193): one rental unit of a `rooms`
 * property with tabs Thông tin / Giá / Ảnh & video. Thông tin and Ảnh save the whole unit
 * list (`PUT units`); Giá is the rates editor narrowed to this unit, which still saves every
 * target as loaded. Leaving with unsaved edits asks first, as the property editor.
 */
export function UnitPage({
  propertyId,
  unitId,
  uploadImage,
  folderId,
  onFolderChange,
}: {
  propertyId: string;
  unitId: string;
  uploadImage?: GalleryImageUpload | undefined;
  folderId?: string | undefined;
  onFolderChange?: ((folderId: string | undefined) => void) | undefined;
}) {
  const { t } = useTranslation('lodging');
  const property = useProperty(propertyId);
  const canEdit = useCan('catalog.manage');
  const [tab, setTab] = useState<TabKey>(folderId ? 'gallery' : 'info');
  const { dirtyTabs, reporter } = useDirtyTabs<TabKey>();

  if (property.isPending) return <Skeleton className="h-96 rounded-xl" />;
  const p = property.data;
  const unit =
    p?.sellMode === 'rooms' ? p.units.find((u) => u.kind === 'room' && u.id === unitId) : undefined;
  if (property.isError || !p || !unit) {
    const missing =
      (property.error instanceof ApiClientError && property.error.status === 404) ||
      (p !== undefined && !unit);
    return (
      <Alert variant="destructive">
        <CircleAlert aria-hidden />
        <AlertDescription className="flex flex-wrap items-center gap-2">
          {missing ? t('units.notFound') : t('loadError')}
          {missing && p ? (
            <Button asChild size="xs" variant="outline">
              <Link
                to="/app/properties/$propertyId"
                params={{ propertyId }}
                search={{ tab: 'rooms' }}
              >
                {t('units.back')}
              </Link>
            </Button>
          ) : (
            <Button size="xs" variant="outline" onClick={() => void property.refetch()}>
              {t('retry')}
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="ghost" className="-ml-2 max-w-full">
          <Link to="/app/properties/$propertyId" params={{ propertyId }} search={{ tab: 'rooms' }}>
            <ChevronLeft aria-hidden />
            <span className="truncate">
              <span className="tabular-nums">{p.code}</span> · {t('units.back')}
            </span>
          </Link>
        </Button>
      </div>
      <div className="grid gap-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-xl font-semibold break-words">{unit.name}</h1>
          <Badge variant="secondary">{t(`units.category.${unit.category}`)}</Badge>
          {!unit.active && <Badge variant="outline">{t('units.inactive')}</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          {[p.name, unit.view, partyLine(t, unit)].filter(Boolean).join(' · ')}
        </p>
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList
          variant="line"
          className="w-full justify-start overflow-x-auto overflow-y-hidden border-b"
        >
          {TABS.map((key) => (
            <TabsTrigger key={key} value={key} className="flex-none px-3">
              {t(`units.tabs.${key}`)}
              {dirtyTabs.has(key) && <UnsavedMark />}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((key) => (
          <TabsContent
            key={key}
            value={key}
            forceMount
            className="pt-4 data-[state=inactive]:hidden"
          >
            {key === 'info' && (
              <UnitInfoTab
                property={p}
                unit={unit}
                canEdit={canEdit}
                onDirtyChange={reporter('info')}
              />
            )}
            {key === 'rates' && (
              <RatesTab
                property={p}
                canEdit={canEdit}
                target={unit.id}
                onDirtyChange={reporter('rates')}
              />
            )}
            {key === 'gallery' && (
              <UnitGallery
                property={p}
                unit={unit}
                canEdit={canEdit}
                onDirtyChange={reporter('gallery')}
                uploadImage={uploadImage}
                folderId={folderId}
                onFolderChange={onFolderChange ?? (() => {})}
              />
            )}
          </TabsContent>
        ))}
      </Tabs>
      <LeaveGuard dirty={dirtyTabs.size > 0} />
    </div>
  );
}

/** "Ảnh & video" of a unit: the property's folder UI on the unit's own gallery. */
function UnitGallery({
  property: p,
  unit,
  ...rest
}: {
  property: PropertyDto;
  unit: UnitDto;
  canEdit: boolean;
  onDirtyChange: (dirty: boolean) => void;
  uploadImage?: GalleryImageUpload | undefined;
  folderId?: string | undefined;
  onFolderChange: (folderId: string | undefined) => void;
}) {
  const base = useMemo(() => galleryDraftOf(unit), [unit]);
  const replace = useReplaceUnits();
  const saveError = useSaveError();
  const save: GallerySave = (draft, done) =>
    replace.mutate(
      {
        id: p.id,
        body: {
          version: p.version,
          units: unitsWith(p, unit.id, {
            gallery: draft.gallery,
            galleryCover: draft.galleryCover,
          }),
        },
      },
      {
        onSuccess: (saved) => {
          const next = saved.units.find((u) => u.id === unit.id);
          done.saved(next ? galleryDraftOf(next) : draft);
        },
        onError: (error) => saveError(error, { onStale: done.stale }),
      },
    );
  return <GalleryForm {...rest} base={base} pending={replace.isPending} onSave={save} />;
}
