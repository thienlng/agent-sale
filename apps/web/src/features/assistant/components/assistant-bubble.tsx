import { useRouterState } from '@tanstack/react-router';
import { Rabbit } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAssistantRequest } from '@/lib/assistant-context';
import { loadNamespace } from '@/lib/i18n';
import { useWorkspaceId } from '@/lib/use-workspace';
import { cn } from '@/lib/utils';

import { useIsAccountOwner } from '@/lib/use-is-account-owner';
import { useAssistantUi } from '../stores/assistant-ui.store';

// The panel (Sheet, chat, steps, spotlight) and its strings load on first open (docs/16 §1).
const AssistantPanel = lazy(() =>
  Promise.all([import('./assistant-panel'), loadNamespace('assistant')]).then(([m]) => ({
    default: m.AssistantPanel,
  })),
);

/** Bot training pages keep their own "Chat thử" button bottom-right; the launcher sits above it. */
const BOT_PAGE = /^\/app\/bots\/[^/]+/;

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
  // A page asked on the owner's behalf (the ask button): open the panel, which takes the request.
  const asked = useAssistantRequest((s) => s.request !== null);
  useEffect(() => {
    if (asked && isOwner) setOpen(true);
  }, [asked, isOwner, setOpen]);
  // Once loaded the panel stays mounted, so a spotlight survives closing it.
  const [loaded, setLoaded] = useState(open);
  if (open && !loaded) setLoaded(true);
  if (!isOwner) return null;
  return (
    <>
      {open ? null : (
        <button
          type="button"
          aria-label={t('app.assistantLauncher')}
          title={t('app.assistantLauncher')}
          onClick={() => setOpen(true)}
          className={cn(
            'fixed right-4 bottom-4 z-40 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
            onBotPage && 'bottom-20',
          )}
        >
          <Rabbit className="size-7" aria-hidden />
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
