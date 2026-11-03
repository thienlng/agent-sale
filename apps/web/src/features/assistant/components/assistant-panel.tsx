import type { AssistantMessageDto, AssistantProposalDto } from '@agent-sales/contracts';
import { useRouter } from '@tanstack/react-router';
import { ArrowLeft, Brain, List, Settings, Sparkles, SquarePen, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { ApiClientError } from '@/lib/api-client';
import {
  collectPageContext,
  fillAssistantForm,
  waitForAssistantForm,
} from '@/lib/assistant-context';
import { useWorkspaceId } from '@/lib/use-workspace';

import {
  useAssistantMessages,
  useAssistantProposals,
  useCreateAssistantThread,
  useSendAssistantMessage,
} from '../api/assistant';
import { useAssistantThreadId, useAssistantUi } from '../stores/assistant-ui.store';
import { NAVIGATE_FOLLOW_UP_TEXT, owesFill, waitForPageForm } from '../utils/navigate-follow-up';
import { safeAppPath } from '../utils/safe-app-path';
import { AssistantComposer } from './assistant-composer';
import { AssistantLearning } from './assistant-learning';
import { AssistantMemory } from './assistant-memory';
import { AssistantMessages } from './assistant-messages';
import { AssistantSettings } from './assistant-settings';
import { AssistantSkills } from './assistant-skills';
import { AssistantSpotlight } from './assistant-spotlight';
import { AssistantSuggestions } from './assistant-suggestions';
import { AssistantThreadList } from './assistant-thread-list';

const NO_MESSAGES: AssistantMessageDto[] = [];
const NO_PROPOSALS: AssistantProposalDto[] = [];
/** How long a `fill_form` after a `navigate` waits for the new page to register its form. */
const FORM_WAIT_MS = 3000;

type PanelView = 'chat' | 'threads' | 'memory' | 'skills' | 'settings';
/** The header's view toggles: icon, and the label to open the view. Pressed, each goes back. */
const VIEW_TOGGLES = [
  { view: 'threads', Icon: List, label: 'showThreads' },
  { view: 'skills', Icon: Sparkles, label: 'showSkills' },
  { view: 'memory', Icon: Brain, label: 'showMemory' },
  { view: 'settings', Icon: Settings, label: 'showSettings' },
] as const;

/**
 * The assistant panel (lazy chunk): a non-modal right-side sheet, 420 px on desktop and full
 * width on phones, so the page stays usable while the owner chats; plus the spotlight overlay.
 */
export function AssistantPanel() {
  const { t } = useTranslation('assistant');
  const router = useRouter();
  const { open, setOpen, setThread, setSpotlight } = useAssistantUi();
  const threadId = useAssistantThreadId(useWorkspaceId());
  const [view, setView] = useState<PanelView>('chat');
  const [pendingTurn, setPendingTurn] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  // The last send hit a turn still running (409): a toast, and a line above the composer.
  const [busy, setBusy] = useState(false);
  const messages = useAssistantMessages(threadId);
  const proposals = useAssistantProposals(threadId);
  const createThread = useCreateAssistantThread();
  const sendMessage = useSendAssistantMessage();
  const sending = pendingTurn !== null || createThread.isPending;
  // The latest send and sending flag, for the follow-up that runs after a later render.
  const latest = useRef({ sending, send });
  useEffect(() => {
    latest.current = { sending, send };
  });

  /**
   * UI actions run in order: navigate inside the dashboard, point at a control, fill a form on
   * screen. A fill never submits: the owner reviews the values and presses the form's own button,
   * which is spotlighted when the form names one. `switched` drops what is left of the answer
   * when the owner changed business meanwhile. Resolves with where the answer navigated (the last
   * in-app target) and whether it carried a `fill_form`.
   */
  async function apply(
    answer: readonly AssistantMessageDto[],
    switched: () => boolean,
  ): Promise<{ navigatedTo: string | null; filled: boolean }> {
    let navigated = false;
    let navigatedTo: string | null = null;
    let filled = false;
    const result = () => ({ navigatedTo, filled });
    for (const action of answer.flatMap((m) => (m.role === 'assistant' ? m.uiActions : []))) {
      if (switched()) return result();
      if (action.type === 'navigate') {
        const to = safeAppPath(action.to);
        if (to) {
          navigated = true;
          navigatedTo = to;
          void router.navigate({ href: to });
        }
      } else if (action.type === 'spotlight') {
        // The sheet would cover the control, so it steps aside; the hint carries the answer.
        setOpen(false);
        setSpotlight({ target: action.target, hint: action.hint });
      } else {
        filled = true;
        // After a navigate the target page mounts a moment later: give it time to register.
        if (navigated) await waitForAssistantForm(action.formId, FORM_WAIT_MS);
        if (switched()) return result();
        const fill = fillAssistantForm(action.formId, action.values);
        if (!fill.ok) {
          toast(t('fill.notOnPage'));
        } else if (fill.submitTarget) {
          setOpen(false);
          setSpotlight({ target: fill.submitTarget, hint: t('fill.reviewHint') });
        }
      }
    }
    return result();
  }

  /**
   * "Open page X and fill it" (B11): the model only sees forms on the page the message was sent
   * from, so a turn that navigated and still owes a fill is continued once, by itself, when the
   * new page has registered its form. The follow-up's text is hidden in the conversation.
   */
  async function continueAfterNavigate(to: string, switched: () => boolean): Promise<void> {
    const ready = await waitForPageForm(to, () => router.state.location.pathname, FORM_WAIT_MS);
    // The owner switched business or sent something else meanwhile: never talk over them.
    if (!ready || switched() || latest.current.sending) return;
    await latest.current.send(NAVIGATE_FOLLOW_UP_TEXT, true);
  }

  /** Sends one message; `followUp` marks the panel's own continuation, which never chains. */
  async function send(text: string, followUp = false): Promise<boolean> {
    setUnavailable(false);
    setBusy(false);
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
      // Not awaited: a fill may wait for the next page, and the composer is free meanwhile.
      if (!switched()) {
        void apply(res.messages, switched).then(({ navigatedTo, filled }) => {
          if (followUp || !navigatedTo || !owesFill(text, res.run.steps, filled)) return;
          return continueAfterNavigate(navigatedTo, switched);
        });
      }
      return true;
    } catch (error) {
      // Another tab or device is mid-turn on this thread: say so; the composer keeps the text.
      if (error instanceof ApiClientError && error.status === 409) {
        toast.error(t('busy'), { id: 'assistant-busy', duration: 8000 });
        if (!switched()) setBusy(true);
      } else if (error instanceof ApiClientError && error.status === 503) setUnavailable(true);
      else toast.error(t('sendError'));
      return false;
    } finally {
      setPendingTurn(null);
    }
  }

  function newThread(): void {
    setThread(null);
    setUnavailable(false);
    setBusy(false);
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
            {VIEW_TOGGLES.map(({ view: target, Icon, label }) => (
              <Button
                key={target}
                variant="ghost"
                size="icon"
                aria-label={view === target ? t('backToChat') : t(label)}
                aria-pressed={view === target}
                onClick={() => setView((v) => (v === target ? 'chat' : target))}
              >
                {view === target ? <ArrowLeft /> : <Icon />}
              </Button>
            ))}
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
                setBusy(false);
                setView('chat');
              }}
            />
          ) : view === 'memory' ? (
            <AssistantMemory />
          ) : view === 'skills' ? (
            <AssistantSkills />
          ) : view === 'settings' ? (
            <AssistantSettings onOpenMemory={() => setView('memory')} />
          ) : (
            <>
              <AssistantLearning onOpenSkills={() => setView('skills')} />
              <AssistantMessages
                messages={threadId ? (messages.data ?? NO_MESSAGES) : NO_MESSAGES}
                proposals={threadId ? (proposals.data ?? NO_PROPOSALS) : NO_PROPOSALS}
                loading={Boolean(threadId) && messages.isPending}
                pendingTurn={pendingTurn}
                unavailable={unavailable}
              />
              <AssistantSuggestions />
              {busy ? (
                <p
                  role="status"
                  className="border-t bg-muted/50 px-4 py-2 text-xs text-muted-foreground"
                >
                  {t('busy')}
                </p>
              ) : null}
              <AssistantComposer sending={sending} onSend={send} />
            </>
          )}
        </SheetContent>
      </Sheet>
      <AssistantSpotlight />
    </>
  );
}
