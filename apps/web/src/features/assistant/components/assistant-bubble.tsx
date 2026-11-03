import { Rabbit } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { loadNamespace } from '@/lib/i18n';
import { useWorkspaceId } from '@/lib/use-workspace';
import { cn } from '@/lib/utils';

import { useIsAccountOwner } from '../hooks/use-is-account-owner';
import { useLauncherBottom } from '../hooks/use-launcher-bottom';
import { useAssistantUi } from '../stores/assistant-ui.store';

// The panel (Sheet, chat, steps, spotlight) and its strings load on first open (docs/16 §1).
const AssistantPanel = lazy(() =>
  Promise.all([import('./assistant-panel'), loadNamespace('assistant')]).then(([m]) => ({
    default: m.AssistantPanel,
  })),
);

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
  // Once loaded the panel stays mounted, so a spotlight survives closing it.
  const [loaded, setLoaded] = useState(open);
  // Steps over a page's bottom-right control marked `data-assistant-avoid` (a Send button).
  const bottom = useLauncherBottom(isOwner && !open);
  if (!isOwner) return null;
  return (
    <>
      {/* Room under the last control of a padded page, so the launcher never covers it; full-bleed
          pages (data-content-padding=false) mark their controls instead. */}
      <div
        aria-hidden
        data-assistant-spacer
        className="h-20 shrink-0 [div:has([data-content-padding=false])>&]:hidden"
      />
      {open ? null : (
        <button
          type="button"
          aria-label={t('app.assistantLauncher')}
          title={t('app.assistantLauncher')}
          onClick={() => {
            setLoaded(true);
            setOpen(true);
          }}
          style={{ bottom }}
          className={cn(
            'fixed right-4 z-40 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
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
