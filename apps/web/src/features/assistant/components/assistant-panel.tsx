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
  type AssistantRequest,
  collectPageContext,
  fillAssistantForm,
  useAssistantRequest,
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
  const messages = useAssistantMessages(threadId);
  const proposals = useAssistantProposals(threadId);
  const createThread = useCreateAssistantThread();
  const sendMessage = useSendAssistantMessage();
  const sending = pendingTurn !== null || createThread.isPending;
  /** A request that arrived while a turn ran: it waits in the composer for the owner to send. */
  const [draft, setDraft] = useState<AssistantRequest | null>(null);

  // A page asked on the owner's behalf (the ask button): open the panel and take it once, now
  // and whenever another arrives. Idle → send it; busy → leave it in the composer. Refs keep the subscription stable.
  const latest = useRef({ sending, send });
  useEffect(() => {
    latest.current = { sending, send };
  });
  useEffect(() => {
    function takeRequest(): void {
      const request = useAssistantRequest.getState().take();
      if (!request) return;
      // Once loaded the panel stays mounted while closed, so taking the request must open it.
      useAssistantUi.getState().setOpen(true);
      setView('chat');
      if (latest.current.sending) setDraft(request);
      else void latest.current.send(request.text);
    }
    takeRequest();
    return useAssistantRequest.subscribe((state) => {
      if (state.request) takeRequest();
    });
  }, []);

  /**
   * UI actions run in order: navigate inside the dashboard, point at a control, fill a form on
   * screen. A fill never submits: the owner reviews the values and presses the form's own button,
   * which is spotlighted when the form names one. A `chart` is rendered inside its message and is
   * not run here, nor is any action type this build does not know. `switched` drops what is left
   * of the answer when the owner changed business meanwhile.
   */
  async function apply(
    answer: readonly AssistantMessageDto[],
    switched: () => boolean,
  ): Promise<void> {
    let navigated = false;
    for (const action of answer.flatMap((m) => (m.role === 'assistant' ? m.uiActions : []))) {
      if (switched()) return;
      if (action.type === 'navigate') {
        const to = safeAppPath(action.to);
        if (to) {
          navigated = true;
          void router.navigate({ href: to });
        }
      } else if (action.type === 'spotlight') {
        // The sheet would cover the control, so it steps aside; the hint carries the answer.
        setOpen(false);
        setSpotlight({ target: action.target, hint: action.hint });
      } else if (action.type === 'fill_form') {
        // After a navigate the target page mounts a moment later: give it time to register.
        if (navigated) await waitForAssistantForm(action.formId, FORM_WAIT_MS);
        if (switched()) return;
        const filled = fillAssistantForm(action.formId, action.values);
        if (!filled.ok) {
          // An open edit of an existing item is never overwritten by a draft.
          toast(t(filled.reason === 'form_busy_editing' ? 'fill.busyEditing' : 'fill.notOnPage'));
        } else if (filled.opensDialog) {
          // The fill opened a modal dialog: a spotlight would sit under it (T175-R5). The panel
          // steps aside and the dialog's own focus leads the owner.
          setOpen(false);
        } else if (filled.submitTarget) {
          setOpen(false);
          setSpotlight({ target: filled.submitTarget, hint: t('fill.reviewHint') });
        }
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
      // Not awaited: a fill may wait for the next page, and the composer is free meanwhile.
      if (!switched()) void apply(res.messages, switched);
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
              <AssistantComposer sending={sending} onSend={send} draft={draft} />
            </>
          )}
        </SheetContent>
      </Sheet>
      <AssistantSpotlight />
    </>
  );
}
