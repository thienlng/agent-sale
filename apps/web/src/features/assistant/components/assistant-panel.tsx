import type { AssistantMessageDto, AssistantProposalDto } from '@agent-sales/contracts';
import { useRouter } from '@tanstack/react-router';
import {
  ArrowLeft,
  Brain,
  CalendarClock,
  KeyRound,
  List,
  Maximize2,
  Settings,
  Sparkles,
  SquarePen,
  X,
} from 'lucide-react';
import { type DragEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { ApiClientError } from '@/lib/api-client';
import {
  type AssistantRequest,
  collectPageContext,
  fillAssistantForm,
  formRegistrationMark,
  useAssistantRequest,
  waitForAssistantForm,
} from '@/lib/assistant-context';
import { safeAppPath } from '@/lib/safe-app-path';
import { useWorkspaceId } from '@/lib/use-workspace';

import {
  useAssistantMessages,
  useAssistantProposals,
  useCreateAssistantThread,
  useSendAssistantMessage,
} from '../api/assistant';
import { useCreateImportBatch } from '../api/imports';
import { useAssistantThreadId, useAssistantUi } from '../stores/assistant-ui.store';
import { NAVIGATE_FOLLOW_UP_TEXT, owesFill, waitForPageForm } from '../utils/navigate-follow-up';
import { useAssistantAttachments } from './assistant-attachments';
import { AssistantComposer } from './assistant-composer';
import { AssistantLearning } from './assistant-learning';
import { AssistantMemory } from './assistant-memory';
import { AssistantMessages } from './assistant-messages';
import { AssistantPageLayout } from './assistant-page-layout';
import { AssistantSchedules } from './assistant-schedules';
import { AssistantSettings } from './assistant-settings';
import { AssistantSkills } from './assistant-skills';
import { AssistantSpotlight } from './assistant-spotlight';
import { AssistantSuggestions } from './assistant-suggestions';
import { AssistantThreadList } from './assistant-thread-list';

const NO_MESSAGES: AssistantMessageDto[] = [];
const NO_PROPOSALS: AssistantProposalDto[] = [];
/** How long a `fill_form` after a `navigate` waits for the new page to register its form. */
const FORM_WAIT_MS = 3000;

type PanelView = 'chat' | 'threads' | 'schedules' | 'memory' | 'skills' | 'settings';
/** The header's view toggles: icon, and the label to open the view. Pressed, each goes back. */
const VIEW_TOGGLES = [
  { view: 'threads', Icon: List, label: 'showThreads' },
  { view: 'schedules', Icon: CalendarClock, label: 'showSchedules' },
  { view: 'skills', Icon: Sparkles, label: 'showSkills' },
  { view: 'memory', Icon: Brain, label: 'showMemory' },
  { view: 'settings', Icon: Settings, label: 'showSettings' },
] as const;
/** The full page of the assistant; also where "expand" goes. */
export const ASSISTANT_PAGE_PATH = '/app/assistant';

/**
 * The assistant panel (lazy chunk), in one of two places with the same conversation:
 * - a non-modal right-side sheet, 420 px on desktop and full width on phones, so the page stays
 *   usable while the owner chats;
 * - the full page `/app/assistant`, rendered into the slot that page registers: conversations on
 *   the left, the views as tabs, the chat at a reading width.
 * Being one component, switching between them keeps the thread, the attachments and a turn
 * running. Plus the spotlight overlay.
 */
export function AssistantPanel() {
  const { t } = useTranslation('assistant');
  const router = useRouter();
  const { open, setOpen, setThread, setSpotlight } = useAssistantUi();
  const pageSlot = useAssistantUi((s) => s.pageSlot);
  const onPage = pageSlot !== null;
  const workspaceId = useWorkspaceId();
  const threadId = useAssistantThreadId(workspaceId);
  const [view, setView] = useState<PanelView>('chat');
  // A thread opened from elsewhere (a report notification) shows the conversation.
  useEffect(() => setView('chat'), [threadId]);
  // The full page has no threads view (its list is always there): show the conversation.
  useEffect(() => {
    if (onPage) setView((v) => (v === 'threads' ? 'chat' : v));
  }, [onPage]);
  // What the owner was typing survives a switch between the sheet and the page (the composer
  // remounts there).
  const typed = useRef('');
  // An accepted schedule suggestion opens the schedule editor.
  const scheduleDraft = useAssistantUi((s) => s.scheduleDraft);
  useEffect(() => {
    if (scheduleDraft) setView('schedules');
  }, [scheduleDraft]);
  const [pendingTurn, setPendingTurn] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  // The last send hit a turn still running (409): a toast, and a line above the composer.
  const [busy, setBusy] = useState(false);
  // The last message carried keys; they were masked before storage (T-174).
  const [secretsRemoved, setSecretsRemoved] = useState(false);
  // Opened from a page with a question: show the conversation, where the composer takes it.
  const launchDraft = useAssistantUi((s) => s.draft);
  useEffect(() => {
    if (launchDraft !== null) setView('chat');
  }, [launchDraft]);
  const messages = useAssistantMessages(threadId);
  const proposals = useAssistantProposals(threadId);
  const createThread = useCreateAssistantThread();
  const sendMessage = useSendAssistantMessage();
  const createImport = useCreateImportBatch();
  // The batch is for the business the owner is on (the dashboard always has one).
  const attachments = useAssistantAttachments(workspaceId);
  const [dragging, setDragging] = useState(false);
  const sending = pendingTurn !== null || createThread.isPending || attachments.creating;
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
   * of the answer when the owner changed business meanwhile. Resolves with where the answer
   * navigated (the last in-app target) and whether it carried a `fill_form`.
   */
  async function apply(
    answer: readonly AssistantMessageDto[],
    switched: () => boolean,
  ): Promise<{ navigatedTo: string | null; filled: boolean; mark: number }> {
    let navigated = false;
    let navigatedTo: string | null = null;
    let filled = false;
    // Forms registered after this belong to the page navigated to, not the one left (B11b).
    let mark = formRegistrationMark();
    const result = () => ({ navigatedTo, filled, mark });
    for (const action of answer.flatMap((m) => (m.role === 'assistant' ? m.uiActions : []))) {
      if (switched()) return result();
      if (action.type === 'navigate') {
        const to = safeAppPath(action.to);
        if (to) {
          // From the full page the conversation follows into the side sheet, next to the page
          // it opens, so a fill or a spotlight that comes next is seen with it.
          const ui = useAssistantUi.getState();
          if (ui.pageSlot && to.split(/[?#]/)[0] !== ASSISTANT_PAGE_PATH) ui.toSheet();
          navigated = true;
          navigatedTo = to;
          mark = formRegistrationMark();
          void router.navigate({ href: to });
        }
      } else if (action.type === 'spotlight') {
        // The sheet would cover the control, so it steps aside; the hint carries the answer.
        setOpen(false);
        setSpotlight({ target: action.target, hint: action.hint });
      } else if (action.type === 'fill_form') {
        filled = true;
        // After a navigate the target page mounts a moment later: give it time to register.
        if (navigated) await waitForAssistantForm(action.formId, FORM_WAIT_MS, mark);
        if (switched()) return result();
        const fill = fillAssistantForm(action.formId, action.values);
        if (!fill.ok) {
          // An open edit of an existing item is never overwritten by a draft.
          toast(t(fill.reason === 'form_busy_editing' ? 'fill.busyEditing' : 'fill.notOnPage'));
        } else if (fill.opensDialog) {
          // The fill opened a modal dialog: a spotlight would sit under it (T175-R5). The panel
          // steps aside and the dialog's own focus leads the owner.
          setOpen(false);
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
  async function continueAfterNavigate(
    to: string,
    mark: number,
    switched: () => boolean,
  ): Promise<void> {
    const path = () => router.state.location.pathname;
    const ready = await waitForPageForm(to, path, FORM_WAIT_MS, mark);
    // The owner switched business or sent something else meanwhile: never talk over them.
    if (!ready || switched() || latest.current.sending) return;
    await latest.current.send(NAVIGATE_FOLLOW_UP_TEXT, true);
  }

  /** Sends one message; `followUp` marks the panel's own continuation, which never chains. */
  async function send(text: string, followUp = false): Promise<boolean> {
    setUnavailable(false);
    setSecretsRemoved(false);
    setBusy(false);
    // Read before anything renders: the route and the targets the owner is looking at.
    const page = collectPageContext(router.state.location.pathname);
    // Ids a page added when it opened the panel (e.g. the bot message's time), for this send only.
    const extras = useAssistantUi.getState().takeEntityExtras();
    const pageContext = extras ? { ...page, entity: { ...page.entity, ...extras } } : page;
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
      let importBatchId: string | undefined;
      let body = text;
      if (attachments.active) {
        const prepared = attachments.request();
        if ('key' in prepared) {
          attachments.setError(prepared);
          return false;
        }
        attachments.setCreating(true);
        try {
          importBatchId = (await createImport.mutateAsync({ threadId: id, ...prepared.body })).id;
        } catch (error) {
          attachments.setError({
            key:
              error instanceof ApiClientError && error.status === 409
                ? 'import.errors.busy'
                : error instanceof ApiClientError && error.details?.['reason'] === 'import_empty'
                  ? 'import.errors.empty'
                  : 'import.errors.batch',
          });
          return false;
        } finally {
          attachments.setCreating(false);
        }
        if (switched()) return false;
        body =
          text ||
          (prepared.body.kind === 'sheet'
            ? t('import.defaultSheetText', { file: prepared.label })
            : t('import.defaultPhotoText', { count: prepared.count }));
      }
      setPendingTurn(turnId);
      const res = await sendMessage.mutateAsync({
        threadId: id,
        turnId,
        text: body,
        pageContext,
        ...(importBatchId ? { importBatchId } : {}),
      });
      // Sent: the batch now belongs to the message (a failed send keeps the tray for a retry).
      if (importBatchId) attachments.clear();
      if (!switched()) setSecretsRemoved(res.secretsRemoved);
      // Not awaited: a fill may wait for the next page, and the composer is free meanwhile.
      if (!switched()) {
        void apply(res.messages, switched).then(({ navigatedTo, filled, mark }) => {
          if (followUp || !navigatedTo || !owesFill(text, res.run.steps, filled)) return;
          return continueAfterNavigate(navigatedTo, mark, switched);
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

  function pickThread(id: string): void {
    setThread(id);
    setUnavailable(false);
    setBusy(false);
    setSecretsRemoved(false);
    setView('chat');
  }

  /** The sheet becomes the full page; the conversation goes with it. */
  function expand(): void {
    if (view === 'threads') setView('chat');
    void router.navigate({ to: ASSISTANT_PAGE_PATH });
  }

  /** The full page goes back to where the owner was, with the conversation in the sheet. */
  function collapse(): void {
    const ui = useAssistantUi.getState();
    ui.toSheet();
    void router.navigate({ href: ui.lastPage ?? '/app/overview' });
  }

  function newThread(): void {
    setThread(null);
    setUnavailable(false);
    setBusy(false);
    setSecretsRemoved(false);
    setView('chat');
  }

  // Files dropped on the conversation are attached to the next message (📎 does the same).
  const dropHandlers = {
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (view !== 'chat' || !event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      setDragging(true);
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (view !== 'chat') return;
      event.preventDefault();
      setDragging(false);
      if (!sending) attachments.addFiles(event.dataTransfer.files);
    },
  };

  const dropOverlay = dragging ? (
    <div
      className="pointer-events-none absolute inset-2 z-10 grid place-items-center rounded-xl border-2 border-dashed border-primary bg-background/90 text-sm font-medium text-brand-text"
      aria-hidden
    >
      {t('import.dropHere')}
    </div>
  ) : null;

  const chat = (
    <>
      <AssistantLearning onOpenSkills={() => setView('skills')} />
      <AssistantMessages
        messages={threadId ? (messages.data ?? NO_MESSAGES) : NO_MESSAGES}
        proposals={threadId ? (proposals.data ?? NO_PROPOSALS) : NO_PROPOSALS}
        loading={Boolean(threadId) && messages.isPending}
        pendingTurn={pendingTurn}
        unavailable={unavailable}
        onStarter={sending ? undefined : (text) => void send(text)}
        roomy={onPage}
      />
      <AssistantSuggestions />
      {busy ? (
        <p role="status" className="border-t bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
          <span data-measure className="block">
            {t('busy')}
          </span>
        </p>
      ) : null}
      {secretsRemoved ? (
        <p role="status" className="border-t bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
          <span data-measure className="flex items-start gap-2">
            <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {t('secretsRemoved')}
          </span>
        </p>
      ) : null}
      <AssistantComposer
        sending={sending}
        onSend={send}
        draft={draft}
        attachments={attachments}
        typed={typed}
      />
    </>
  );

  /** The current view's body; the threads view exists in the sheet only. */
  function body(): ReactNode {
    if (view === 'threads' && !onPage)
      return <AssistantThreadList currentId={threadId} onPick={pickThread} />;
    if (view === 'memory') return <AssistantMemory />;
    if (view === 'skills') return <AssistantSkills />;
    // On the page, memory has its own place in the rail: no second way to it.
    if (view === 'settings')
      return <AssistantSettings onOpenMemory={onPage ? undefined : () => setView('memory')} />;
    if (view === 'schedules') return <AssistantSchedules />;
    return chat;
  }

  const page = pageSlot
    ? createPortal(
        <AssistantPageLayout
          threadId={threadId}
          view={view === 'threads' ? 'chat' : view}
          onView={setView}
          onPickThread={pickThread}
          onNewThread={newThread}
          onCollapse={collapse}
          dropHandlers={dropHandlers}
        >
          {dropOverlay}
          {body()}
        </AssistantPageLayout>,
        pageSlot,
      )
    : null;

  return (
    <>
      {page}
      <Sheet open={open && !onPage} onOpenChange={setOpen} modal={false}>
        <SheetContent
          side="right"
          showCloseButton={false}
          // Non-modal: clicks on the page must not close the conversation.
          onInteractOutside={(event) => event.preventDefault()}
          // No `relative` here: tailwind-merge would drop the sheet's `fixed`, and the panel would
          // render in the page flow. `fixed` is already the containing block of the drop overlay.
          className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:w-[420px] data-[side=right]:sm:max-w-[420px]"
          {...dropHandlers}
        >
          {dropOverlay}
          <header className="flex items-center gap-0.5 border-b py-2 pr-2 pl-4">
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate font-semibold">{t('title')}</SheetTitle>
              {/* Read by screen readers; no room beside the view toggles. */}
              <SheetDescription className="sr-only">{t('subtitle')}</SheetDescription>
            </div>
            {VIEW_TOGGLES.map(({ view: target, Icon, label }) => (
              <Button
                key={target}
                variant="ghost"
                size="icon-sm"
                aria-label={view === target ? t('backToChat') : t(label)}
                aria-pressed={view === target}
                onClick={() => setView((v) => (v === target ? 'chat' : target))}
              >
                {view === target ? <ArrowLeft /> : <Icon />}
              </Button>
            ))}
            <Button variant="ghost" size="icon-sm" aria-label={t('newThread')} onClick={newThread}>
              <SquarePen />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="max-sm:hidden"
              aria-label={t('expand')}
              title={t('expand')}
              onClick={expand}
            >
              <Maximize2 />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('close')}
              onClick={() => setOpen(false)}
            >
              <X />
            </Button>
          </header>
          {onPage ? null : body()}
        </SheetContent>
      </Sheet>
      <AssistantSpotlight />
    </>
  );
}
