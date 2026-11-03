import type { AssistantMessageDto, AssistantProposalDto } from '@agent-sales/contracts';
import { useRouter } from '@tanstack/react-router';
import { ArrowLeft, Brain, List, SquarePen, X } from 'lucide-react';
import { useState } from 'react';
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
import { useCreateImportBatch } from '../api/imports';
import { useAssistantThreadId, useAssistantUi } from '../stores/assistant-ui.store';
import { safeAppPath } from '../utils/safe-app-path';
import { useAssistantAttachments } from './assistant-attachments';
import { AssistantComposer } from './assistant-composer';
import { AssistantMemory } from './assistant-memory';
import { AssistantMessages } from './assistant-messages';
import { AssistantSpotlight } from './assistant-spotlight';
import { AssistantThreadList } from './assistant-thread-list';

const NO_MESSAGES: AssistantMessageDto[] = [];
const NO_PROPOSALS: AssistantProposalDto[] = [];
/** How long a `fill_form` after a `navigate` waits for the new page to register its form. */
const FORM_WAIT_MS = 3000;

/**
 * The assistant panel (lazy chunk): a non-modal right-side sheet, 420 px on desktop and full
 * width on phones, so the page stays usable while the owner chats; plus the spotlight overlay.
 */
export function AssistantPanel() {
  const { t } = useTranslation('assistant');
  const router = useRouter();
  const { open, setOpen, setThread, setSpotlight } = useAssistantUi();
  const workspaceId = useWorkspaceId();
  const threadId = useAssistantThreadId(workspaceId);
  const [view, setView] = useState<'chat' | 'threads' | 'memory'>('chat');
  const [pendingTurn, setPendingTurn] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const messages = useAssistantMessages(threadId);
  const proposals = useAssistantProposals(threadId);
  const createThread = useCreateAssistantThread();
  const sendMessage = useSendAssistantMessage();
  const createImport = useCreateImportBatch();
  // The batch is for the business the owner is on (the dashboard always has one).
  const attachments = useAssistantAttachments(workspaceId);
  const [dragging, setDragging] = useState(false);
  const sending = pendingTurn !== null || createThread.isPending || attachments.creating;

  /**
   * UI actions run in order: navigate inside the dashboard, point at a control, fill a form on
   * screen. A fill never submits: the owner reviews the values and presses the form's own button,
   * which is spotlighted when the form names one. `switched` drops what is left of the answer
   * when the owner changed business meanwhile.
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
      } else {
        // After a navigate the target page mounts a moment later: give it time to register.
        if (navigated) await waitForAssistantForm(action.formId, FORM_WAIT_MS);
        if (switched()) return;
        const filled = fillAssistantForm(action.formId, action.values);
        if (!filled.ok) {
          toast(t('fill.notOnPage'));
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
          // No `relative` here: tailwind-merge would drop the sheet's `fixed`, and the panel would
          // render in the page flow. `fixed` is already the containing block of the drop overlay.
          className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:w-[420px] data-[side=right]:sm:max-w-[420px]"
          // Files dropped on the panel are attached to the next message (📎 does the same).
          onDragOver={(event) => {
            if (view !== 'chat' || !event.dataTransfer.types.includes('Files')) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              setDragging(false);
          }}
          onDrop={(event) => {
            if (view !== 'chat') return;
            event.preventDefault();
            setDragging(false);
            if (!sending) attachments.addFiles(event.dataTransfer.files);
          }}
        >
          {dragging ? (
            <div
              className="pointer-events-none absolute inset-2 z-10 grid place-items-center rounded-xl border-2 border-dashed border-primary bg-background/90 text-sm font-medium text-primary"
              aria-hidden
            >
              {t('import.dropHere')}
            </div>
          ) : null}
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
            <Button
              variant="ghost"
              size="icon"
              aria-label={view === 'memory' ? t('hideMemory') : t('showMemory')}
              aria-pressed={view === 'memory'}
              onClick={() => setView((v) => (v === 'memory' ? 'chat' : 'memory'))}
            >
              {view === 'memory' ? <ArrowLeft /> : <Brain />}
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
          ) : view === 'memory' ? (
            <AssistantMemory />
          ) : (
            <>
              <AssistantMessages
                messages={threadId ? (messages.data ?? NO_MESSAGES) : NO_MESSAGES}
                proposals={threadId ? (proposals.data ?? NO_PROPOSALS) : NO_PROPOSALS}
                loading={Boolean(threadId) && messages.isPending}
                pendingTurn={pendingTurn}
                unavailable={unavailable}
              />
              <AssistantComposer sending={sending} onSend={send} attachments={attachments} />
            </>
          )}
        </SheetContent>
      </Sheet>
      <AssistantSpotlight />
    </>
  );
}
