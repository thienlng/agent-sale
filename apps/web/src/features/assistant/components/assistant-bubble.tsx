import { useRouterState } from '@tanstack/react-router';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { toast } from 'sonner';

import { BrandMark } from '@/components/logo';
import { ApiClientError } from '@/lib/api-client';
import { useAssistantOpenRequests, useAssistantRequest } from '@/lib/assistant-context';
import { registerAssistantOpener } from '@/lib/assistant-launch';
import { loadNamespace } from '@/lib/i18n';
import { useIsAccountOwner } from '@/lib/use-is-account-owner';
import { useWorkspaceId } from '@/lib/use-workspace';
import { cn } from '@/lib/utils';

import { openReportThread } from '../api/report-thread';
import { LAUNCHER_INSET, useLauncherBottom } from '../hooks/use-launcher-bottom';
import { useLauncherDrag } from '../hooks/use-launcher-drag';
import { useAssistantUi } from '../stores/assistant-ui.store';

// The panel (Sheet, chat, steps, spotlight) and its strings load on first open (docs/16 §1).
const AssistantPanel = lazy(() =>
  Promise.all([import('./assistant-panel'), loadNamespace('assistant')]).then(([m]) => ({
    default: m.AssistantPanel,
  })),
);

/** Long enough to read a report body in the toast. */
const REPORT_GONE_TOAST_MS = 15_000;

/** The owner assistant ("Thỏ Rapiz"): a round launcher bottom-right, owners of the account only. */
export function AssistantBubble() {
  const { t } = useTranslation();
  const isOwner = useIsAccountOwner();
  const open = useAssistantUi((s) => s.open);
  const setOpen = useAssistantUi((s) => s.setOpen);
  const workspaceId = useWorkspaceId();
  const syncWorkspace = useAssistantUi((s) => s.syncWorkspace);
  // Another business, another conversation: drop the thread and any spotlight on a switch.
  useEffect(() => syncWorkspace(workspaceId || null), [workspaceId, syncWorkspace]);
  // A page asked on the owner's behalf (the ask button): open the panel, which takes the request.
  const asked = useAssistantRequest((s) => s.request !== null);
  useEffect(() => {
    if (asked && isOwner) setOpen(true);
  }, [asked, isOwner, setOpen]);
  // The full page (`/app/assistant`) shows the panel in place of the launcher.
  const onPage = useAssistantUi((s) => s.pageSlot !== null);
  // Once loaded the panel stays mounted, so a spotlight survives closing it.
  const [loaded, setLoaded] = useState(open || onPage);
  if ((open || onPage) && !loaded) setLoaded(true);
  // Collapsing the full page goes back to the page the owner came from.
  const href = useRouterState({ select: (s) => s.location.href });
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const setLastPage = useAssistantUi((s) => s.setLastPage);
  useEffect(() => {
    if (pathname !== '/app/assistant') setLastPage(href);
  }, [href, pathname, setLastPage]);
  // Other features open the panel through lib/assistant-launch, only while the bubble is shown.
  const openWith = useAssistantUi((s) => s.openWith);
  useEffect(() => {
    if (!isOwner) return;
    return registerAssistantOpener((text, entity) => {
      setLoaded(true);
      openWith(text, entity);
    });
  }, [isOwner, openWith]);
  const setThread = useAssistantUi((s) => s.setThread);
  const { request, consume } = useAssistantOpenRequests();
  // Another feature asked to open a thread (the bell's report notification, T-172).
  useEffect(() => {
    if (!request || !isOwner || !workspaceId) return;
    consume(request.seq);
    setLoaded(true);
    if ('threadId' in request) {
      setOpen(true);
      setThread(request.threadId);
      return;
    }
    // Opens once the thread is known, so a failure never shows the panel's previous view.
    openReportThread(workspaceId, request.reportRunId).then(
      (thread) => {
        setThread(thread.id);
        setOpen(true);
      },
      (error: unknown) => {
        if (error instanceof ApiClientError && error.status === 404) {
          // The schedule was deleted with its runs; the notification still has the report.
          toast.error(t('app.reportScheduleDeleted'), {
            description: request.body,
            duration: REPORT_GONE_TOAST_MS,
          });
        } else toast.error(t('app.reportThreadError'));
      },
    );
  }, [request, isOwner, workspaceId, consume, setOpen, setThread, t]);
  // The owner can drag it anywhere (or Alt+arrows); a moved launcher stays where it was put.
  const openPanel = useCallback(() => setOpen(true), [setOpen]);
  const drag = useLauncherDrag(openPanel);
  // At its default place it steps over a bottom-right control marked `data-assistant-avoid`.
  const bottom = useLauncherBottom(isOwner && !open && !onPage && drag.position === null);
  const place = drag.position ?? { right: LAUNCHER_INSET, bottom };
  if (!isOwner) return null;
  return (
    <>
      {/* Room under the last control of a padded page, so the launcher never covers it; full-bleed
          pages (data-content-padding=false) mark their controls instead. */}
      {onPage ? null : (
        <div
          aria-hidden
          data-assistant-spacer
          className="h-20 shrink-0 [div:has([data-content-padding=false])>&]:hidden"
        />
      )}
      {open || onPage ? null : (
        <button
          type="button"
          aria-label={t('app.assistantLauncher')}
          title={t('app.assistantLauncherHint')}
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight"
          {...drag.handlers}
          style={place}
          className={cn(
            'fixed z-40 grid size-14 touch-none place-items-center rounded-full border border-sidebar-border bg-sidebar shadow-lg select-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-offset-3 focus-visible:ring-offset-background focus-visible:ring-ring focus-visible:outline-none',
            drag.dragging ? 'cursor-grabbing shadow-xl' : 'transition',
          )}
        >
          <BrandMark className="h-6" />
          <span
            aria-hidden
            className="absolute top-2 right-2 size-2.5 rounded-full bg-ai-brand ring-2 ring-sidebar"
          />
        </button>
      )}
      {loaded ? (
        <Suspense fallback={null}>
          <AssistantPanel />
        </Suspense>
      ) : null}
    </>
  );
}
