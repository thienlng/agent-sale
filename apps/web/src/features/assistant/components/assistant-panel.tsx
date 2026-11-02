import type { AssistantMessageDto } from '@agent-sales/contracts';
import { useRouter } from '@tanstack/react-router';
import { ArrowLeft, List, SquarePen, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { ApiClientError } from '@/lib/api-client';
import { useWorkspaceId } from '@/lib/use-workspace';

import {
  useAssistantMessages,
  useCreateAssistantThread,
  useSendAssistantMessage,
} from '../api/assistant';
import { collectPageContext } from '../hooks/use-assistant-context';
import { useAssistantThreadId, useAssistantUi } from '../stores/assistant-ui.store';
import { safeAppPath } from '../utils/safe-app-path';
import { AssistantComposer } from './assistant-composer';
import { AssistantMessages } from './assistant-messages';
import { AssistantSpotlight } from './assistant-spotlight';
import { AssistantThreadList } from './assistant-thread-list';

const NO_MESSAGES: AssistantMessageDto[] = [];

/**
 * The assistant panel (lazy chunk): a non-modal right-side sheet, 420 px on desktop and full
 * width on phones, so the page stays usable while the owner chats; plus the spotlight overlay.
 */
export function AssistantPanel() {
  const { t } = useTranslation('assistant');
  const router = useRouter();
  const { open, setOpen, setThread, setSpotlight } = useAssistantUi();
  const threadId = useAssistantThreadId(useWorkspaceId());
  const [view, setView] = useState<'chat' | 'threads'>('chat');
  const [pendingTurn, setPendingTurn] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const messages = useAssistantMessages(threadId);
  const createThread = useCreateAssistantThread();
  const sendMessage = useSendAssistantMessage();
  const sending = pendingTurn !== null || createThread.isPending;

  /** UI actions run in order: navigate inside the dashboard, then point at a control. */
  function apply(answer: readonly AssistantMessageDto[]): void {
    for (const action of answer.flatMap((m) => (m.role === 'assistant' ? m.uiActions : []))) {
      if (action.type === 'navigate') {
        const to = safeAppPath(action.to);
        if (to) void router.navigate({ href: to });
      } else {
        // The sheet would cover the control, so it steps aside; the hint carries the answer.
        setOpen(false);
        setSpotlight({ target: action.target, hint: action.hint });
      }
    }
  }

  async function send(text: string): Promise<boolean> {
    setUnavailable(false);
    // Read before anything renders: the route and the targets the owner is looking at.
    const pageContext = collectPageContext(router.state.location.pathname);
    const turnId = crypto.randomUUID();
    // The business this message is for: if the owner switches business while it is on its way,
    // the store has started over for the new one and the result must not land there.
    const sentFor = useAssistantUi.getState().workspaceId;
    const switched = () => useAssistantUi.getState().workspaceId !== sentFor;
    try {
      let id = threadId;
      if (!id) {
        id = (await createThread.mutateAsync()).id;
        if (switched()) return false;
        setThread(id);
      }
      setPendingTurn(turnId);
      const res = await sendMessage.mutateAsync({ threadId: id, turnId, text, pageContext });
      if (!switched()) apply(res.messages);
      return true;
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 409) toast.error(t('busy'));
      else if (error instanceof ApiClientError && error.status === 503) setUnavailable(true);
      else toast.error(t('sendError'));
      return false;
    } finally {
      setPendingTurn(null);
    }
  }

  function newThread(): void {
    setThread(null);
    setUnavailable(false);
    setView('chat');
  }

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen} modal={false}>
        <SheetContent
          side="right"
          showCloseButton={false}
          // Non-modal: clicks on the page must not close the conversation.
          onInteractOutside={(event) => event.preventDefault()}
          className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:w-[420px] data-[side=right]:sm:max-w-[420px]"
        >
          <header className="flex items-center gap-1 border-b py-2 pr-2 pl-4">
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate font-semibold">{t('title')}</SheetTitle>
              <SheetDescription className="truncate text-xs">{t('subtitle')}</SheetDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={view === 'threads' ? t('hideThreads') : t('showThreads')}
              aria-pressed={view === 'threads'}
              onClick={() => setView((v) => (v === 'threads' ? 'chat' : 'threads'))}
            >
              {view === 'threads' ? <ArrowLeft /> : <List />}
            </Button>
            <Button variant="ghost" size="icon" aria-label={t('newThread')} onClick={newThread}>
              <SquarePen />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('close')}
              onClick={() => setOpen(false)}
            >
              <X />
            </Button>
          </header>
          {view === 'threads' ? (
            <AssistantThreadList
              currentId={threadId}
              onPick={(id) => {
                setThread(id);
                setUnavailable(false);
                setView('chat');
              }}
            />
          ) : (
            <>
              <AssistantMessages
                messages={threadId ? (messages.data ?? NO_MESSAGES) : NO_MESSAGES}
                loading={Boolean(threadId) && messages.isPending}
                pendingTurn={pendingTurn}
                unavailable={unavailable}
              />
              <AssistantComposer sending={sending} onSend={send} />
            </>
          )}
        </SheetContent>
      </Sheet>
      <AssistantSpotlight />
    </>
  );
}
