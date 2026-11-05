import { Link, useBlocker } from '@tanstack/react-router';
import { ChevronLeft, CircleAlert } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiClientError } from '@/lib/api-client';
import { useCan } from '@/lib/permissions';

import { useProperty } from '../api/properties';
import type { GalleryImageUpload } from '../lib/gallery-model';
import { GalleryTab } from './gallery-tab';
import { InfoTab } from './info-tab';
import { PoliciesTab } from './policies-tab';
import { RatesTab } from './rates-tab';
import { RoomsTab } from './rooms-tab';

type TabKey = 'info' | 'rooms' | 'rates' | 'policies' | 'gallery';

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
}: {
  propertyId: string;
  uploadImage?: GalleryImageUpload | undefined;
  /** The open gallery folder (route search `folder`); opens the "Ảnh & video" tab. */
  folderId?: string | undefined;
  onFolderChange?: ((folderId: string | undefined) => void) | undefined;
}) {
  const { t } = useTranslation();
  const property = useProperty(propertyId);
  const canEdit = useCan('catalog.manage');
  const [tab, setTab] = useState<TabKey>(folderId ? 'gallery' : 'info');
  const [dirtyTabs, setDirtyTabs] = useState<ReadonlySet<TabKey>>(new Set());
  const reporters = useReporters(setDirtyTabs);
  const dirty = dirtyTabs.size > 0;
  const blocker = useBlocker({
    // Opening or closing a gallery folder only changes the search: that is not leaving the page.
    shouldBlockFn: ({ current, next }) => dirty && current.pathname !== next.pathname,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });

  if (property.isPending) return <Skeleton className="h-96 rounded-xl" />;
  if (property.isError || !property.data)
    return (
      <Alert variant="destructive">
        <CircleAlert aria-hidden />
        <AlertDescription className="flex flex-wrap items-center gap-2">
          {property.error instanceof ApiClientError && property.error.status === 404
            ? t('lodging.editor.notFound')
            : t('lodging.loadError')}
          <Button size="xs" variant="outline" onClick={() => void property.refetch()}>
            {t('lodging.retry')}
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
            {t('lodging.editor.back')}
          </Link>
        </Button>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold">
          <span className="tabular-nums">{p.code}</span> · {p.name}
        </h1>
        <Badge variant="secondary">{t(`lodging.sellMode.${p.sellMode}`)}</Badge>
        {p.status === 'paused' && <Badge variant="outline">{t('lodging.places.paused')}</Badge>}
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList variant="line" className="w-full justify-start overflow-x-auto border-b">
          {tabs.map((key) => (
            <TabsTrigger key={key} value={key} className="flex-none px-3">
              {t(`lodging.editor.tabs.${key}`)}
              {dirtyTabs.has(key) && (
                <>
                  <span aria-hidden className="size-1.5 rounded-full bg-primary" />
                  <span className="sr-only">{t('lodging.editor.unsavedMark')}</span>
                </>
              )}
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
            {key === 'info' && <InfoTab {...shared} onDirtyChange={reporters.info} />}
            {key === 'rooms' && <RoomsTab {...shared} onDirtyChange={reporters.rooms} />}
            {key === 'rates' && <RatesTab {...shared} onDirtyChange={reporters.rates} />}
            {key === 'policies' && <PoliciesTab {...shared} onDirtyChange={reporters.policies} />}
            {key === 'gallery' && (
              <GalleryTab
                {...shared}
                onDirtyChange={reporters.gallery}
                uploadImage={uploadImage}
                folderId={folderId}
                onFolderChange={onFolderChange ?? (() => {})}
              />
            )}
          </TabsContent>
        ))}
      </Tabs>
      <Dialog open={blocker.status === 'blocked'} onOpenChange={(o) => !o && blocker.reset?.()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('lodging.editor.leaveTitle')}</DialogTitle>
            <DialogDescription>{t('lodging.editor.leaveDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => blocker.reset?.()}>
              {t('lodging.editor.stay')}
            </Button>
            <Button variant="destructive" onClick={() => blocker.proceed?.()}>
              {t('lodging.editor.leave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Stable per-tab callbacks that add/remove the tab from the dirty set. */
function useReporters(
  setDirtyTabs: (update: (s: ReadonlySet<TabKey>) => ReadonlySet<TabKey>) => void,
) {
  const make = useCallback(
    (key: TabKey) => (dirty: boolean) =>
      setDirtyTabs((s) => {
        if (s.has(key) === dirty) return s;
        const next = new Set(s);
        if (dirty) next.add(key);
        else next.delete(key);
        return next;
      }),
    [setDirtyTabs],
  );
  const [reporters] = useState(() => ({
    info: make('info'),
    rooms: make('rooms'),
    rates: make('rates'),
    policies: make('policies'),
    gallery: make('gallery'),
  }));
  return reporters;
}
