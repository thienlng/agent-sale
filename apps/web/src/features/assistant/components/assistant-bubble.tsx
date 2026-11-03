import { useRouterState } from '@tanstack/react-router';
import { Rabbit } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { toast } from 'sonner';

import { ApiClientError } from '@/lib/api-client';
import { useAssistantOpenRequests } from '@/lib/assistant-context';
import { loadNamespace } from '@/lib/i18n';
import { useWorkspaceId } from '@/lib/use-workspace';
import { cn } from '@/lib/utils';

import { openReportThread } from '../api/report-thread';
import { useIsAccountOwner } from '../hooks/use-is-account-owner';
import { useAssistantUi } from '../stores/assistant-ui.store';

// The panel (Sheet, chat, steps, spotlight) and its strings load on first open (docs/16 §1).
const AssistantPanel = lazy(() =>
  Promise.all([import('./assistant-panel'), loadNamespace('assistant')]).then(([m]) => ({
    default: m.AssistantPanel,
  })),
);

/** Bot training pages keep their own "Chat thử" button bottom-right; the launcher sits above it. */
const BOT_PAGE = /^\/app\/bots\/[^/]+/;

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
  const onBotPage = useRouterState({ select: (s) => BOT_PAGE.test(s.location.pathname) });
  // Once loaded the panel stays mounted, so a spotlight survives closing it.
  const [loaded, setLoaded] = useState(open);
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
  if (!isOwner) return null;
  return (
    <>
      {open ? null : (
        <button
          type="button"
          aria-label={t('app.assistantLauncher')}
          title={t('app.assistantLauncher')}
          onClick={() => {
            setLoaded(true);
            setOpen(true);
          }}
          className={cn(
            'fixed right-4 bottom-4 z-40 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
            onBotPage && 'bottom-20',
          )}
        >
          <Rabbit className="size-7" aria-hidden />
        </button>
      )}
      {loaded || open ? (
        <Suspense fallback={null}>
          <AssistantPanel />
        </Suspense>
      ) : null}
    </>
  );
}
