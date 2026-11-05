import { Link } from '@tanstack/react-router';
import { ChevronLeft, CircleAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiClientError } from '@/lib/api-client';
import { useCan } from '@/lib/permissions';

import { useProperty } from '../api/properties';
import type { GalleryImageUpload } from '../lib/gallery-model';
import { LeaveGuard, UnsavedMark, useDirtyTabs } from './editor-shell';
import { GalleryTab } from './gallery-tab';
import { InfoTab } from './info-tab';
import { PoliciesTab } from './policies-tab';
import { RatesTab } from './rates-tab';
import { RoomsTab } from './rooms-tab';

export type PropertyTabKey = 'info' | 'rooms' | 'rates' | 'policies' | 'gallery';
type TabKey = PropertyTabKey;

/**
 * Property editor (`/app/properties/{id}`): one tab per part, each saved on its own
 * with the property version. Tabs stay mounted so switching keeps unsaved edits; leaving
 * the page with unsaved edits asks first (in-app navigation and closing the tab).
 */
export function PropertyEditor({
  propertyId,
  uploadImage,
  folderId,
  onFolderChange,
  initialTab,
}: {
  propertyId: string;
  uploadImage?: GalleryImageUpload | undefined;
  /** The open gallery folder (route search `folder`); opens the "Ảnh & video" tab. */
  folderId?: string | undefined;
  onFolderChange?: ((folderId: string | undefined) => void) | undefined;
  /** The tab to open first (e.g. "Đơn vị cho thuê" when coming back from a unit page). */
  initialTab?: PropertyTabKey | undefined;
}) {
  const { t } = useTranslation('lodging');
  const property = useProperty(propertyId);
  const canEdit = useCan('catalog.manage');
  const [tab, setTab] = useState<TabKey>(folderId ? 'gallery' : (initialTab ?? 'info'));
  const { dirtyTabs, reporter } = useDirtyTabs<TabKey>();

  if (property.isPending) return <Skeleton className="h-96 rounded-xl" />;
  if (property.isError || !property.data)
    return (
      <Alert variant="destructive">
        <CircleAlert aria-hidden />
        <AlertDescription className="flex flex-wrap items-center gap-2">
          {property.error instanceof ApiClientError && property.error.status === 404
            ? t('editor.notFound')
            : t('loadError')}
          <Button size="xs" variant="outline" onClick={() => void property.refetch()}>
            {t('retry')}
          </Button>
        </AlertDescription>
      </Alert>
    );

  const p = property.data;
  const tabs: TabKey[] =
    p.sellMode === 'rooms'
      ? ['info', 'rooms', 'rates', 'policies', 'gallery']
      : ['info', 'rates', 'policies', 'gallery'];
  const shared = { property: p, canEdit };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="ghost" className="-ml-2">
          <Link to="/app/properties">
            <ChevronLeft aria-hidden />
            {t('editor.back')}
          </Link>
        </Button>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold">
          <span className="tabular-nums">{p.code}</span> · {p.name}
        </h1>
        <Badge variant="secondary">{t(`sellMode.${p.sellMode}`)}</Badge>
        {p.status === 'paused' && <Badge variant="outline">{t('places.paused')}</Badge>}
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList
          variant="line"
          className="w-full justify-start overflow-x-auto overflow-y-hidden border-b"
        >
          {tabs.map((key) => (
            <TabsTrigger key={key} value={key} className="flex-none px-3">
              {t(`editor.tabs.${key}`)}
              {dirtyTabs.has(key) && <UnsavedMark />}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((key) => (
          <TabsContent
            key={key}
            value={key}
            forceMount
            className="pt-4 data-[state=inactive]:hidden"
          >
            {key === 'info' && <InfoTab {...shared} onDirtyChange={reporter('info')} />}
            {key === 'rooms' && <RoomsTab {...shared} />}
            {key === 'rates' && <RatesTab {...shared} onDirtyChange={reporter('rates')} />}
            {key === 'policies' && <PoliciesTab {...shared} onDirtyChange={reporter('policies')} />}
            {key === 'gallery' && (
              <GalleryTab
                {...shared}
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
