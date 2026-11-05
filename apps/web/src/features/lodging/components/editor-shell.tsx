import { useBlocker } from '@tanstack/react-router';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Unsaved tabs of an editor page: `reporter(key)` is a stable callback per tab that adds or
 * removes the tab from the dirty set (the tab marker and the leave guard read it).
 */
export function useDirtyTabs<K extends string>() {
  const [dirtyTabs, setDirtyTabs] = useState<ReadonlySet<K>>(new Set());
  const cache = useRef(new Map<K, (dirty: boolean) => void>());
  const reporter = useCallback((key: K) => {
    let fn = cache.current.get(key);
    if (!fn) {
      fn = (dirty: boolean) =>
        setDirtyTabs((s) => {
          if (s.has(key) === dirty) return s;
          const next = new Set(s);
          if (dirty) next.add(key);
          else next.delete(key);
          return next;
        });
      cache.current.set(key, fn);
    }
    return fn;
  }, []);
  return { dirtyTabs, reporter };
}

/** The "unsaved" dot of a tab trigger. */
export function UnsavedMark() {
  const { t } = useTranslation('lodging');
  return (
    <>
      <span aria-hidden className="size-1.5 rounded-full bg-primary" />
      <span className="sr-only">{t('editor.unsavedMark')}</span>
    </>
  );
}

/**
 * Asks before leaving a page with unsaved edits (in-app navigation and closing the tab).
 * A change of the search only (e.g. opening a gallery folder) is not leaving the page.
 */
export function LeaveGuard({ dirty }: { dirty: boolean }) {
  const { t } = useTranslation('lodging');
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) => dirty && current.pathname !== next.pathname,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });
  return (
    <Dialog open={blocker.status === 'blocked'} onOpenChange={(o) => !o && blocker.reset?.()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('editor.leaveTitle')}</DialogTitle>
          <DialogDescription>{t('editor.leaveDescription')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => blocker.reset?.()}>
            {t('editor.stay')}
          </Button>
          <Button variant="destructive" onClick={() => blocker.proceed?.()}>
            {t('editor.leave')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
