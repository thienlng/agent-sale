import { ClipboardPlus, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { peekPendingDraft, takePendingDraft } from '@/lib/pending-reply-draft';
import { useCan } from '@/lib/permissions';
import { useWorkspaceId } from '@/lib/use-workspace';

import { useConversationTasks, useSignal } from '../api/brain';
import { useItemActions } from '../hooks/use-item-actions';
import { StageBadge, StageMenu } from './stage-menu';
import { TaskDialog, type TaskSubject } from './task-dialog';
import { TaskRow } from './today-queue';

/**
 * The AI's read of the open conversation for the inbox customer panel: stage, mood, intent, why a
 * person is needed, the follow-up and the note, with "Đánh giá lại" and the stage menu.
 */
export function ConversationSignalSummary({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation('brain');
  const signal = useSignal(conversationId);
  const actions = useItemActions();
  const canAct = useCan('contacts.edit');
  const s = signal.data;
  const evaluating = actions.evaluating === conversationId;
  return (
    <div className="flex flex-col gap-2 text-sm">
      {s ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <StageBadge stage={s.stage} locked={s.stageLocked} />
            {s.mood !== 'neutral' ? (
              <span className="text-xs text-muted-foreground">{t(`mood.${s.mood}`)}</span>
            ) : null}
          </div>
          {s.intent ? <p className="break-words">{s.intent}</p> : null}
          {s.needsHuman && s.needsHumanReason ? (
            <p className="break-words text-destructive">
              {t('panel.needsHuman', { reason: s.needsHumanReason })}
            </p>
          ) : null}
          {s.followUpAt ? (
            <p className="text-muted-foreground">
              {t('panel.followUp', { time: formatDateTime(s.followUpAt) })}
              {s.followUpReason ? ` · ${s.followUpReason}` : ''}
            </p>
          ) : null}
          {s.note ? (
            <p className="line-clamp-6 text-xs break-words whitespace-pre-line text-muted-foreground">
              {s.note}
            </p>
          ) : null}
          {s.evaluatedAt ? (
            <p className="text-xs text-muted-foreground">
              {t('panel.evaluatedAt', { time: formatRelativeTime(s.evaluatedAt) })}
            </p>
          ) : null}
        </>
      ) : signal.isLoading ? null : (
        <p className="text-muted-foreground">{t('panel.never')}</p>
      )}
      {canAct ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            variant="outline"
            size="xs"
            disabled={evaluating}
            onClick={() => actions.evaluate(conversationId)}
          >
            <RefreshCw className={evaluating ? 'animate-spin' : undefined} aria-hidden />
            {t('item.evaluate')}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="xs">
                {t('stage.menu')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <StageMenu
                inline
                conversationId={conversationId}
                stage={s?.stage ?? 'new'}
                locked={s?.stageLocked ?? false}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </div>
  );
}

/** Open tasks of the conversation, with "Thêm việc". */
export function ConversationTasks({
  subject,
}: {
  subject: TaskSubject & { conversationId: string };
}) {
  const { t } = useTranslation('brain');
  const viewAll = useCan('contacts.view_all');
  const tasks = useConversationTasks(subject.conversationId, viewAll ? 'all' : 'mine');
  const [open, setOpen] = useState(false);
  const now = Date.now();
  return (
    <div className="flex flex-col gap-2">
      {tasks.data?.length ? (
        <ul className="-mx-4 divide-y">
          {tasks.data.map((task) => (
            <TaskRow key={task.id} task={task} now={now} />
          ))}
        </ul>
      ) : tasks.isLoading ? null : (
        <p className="text-sm text-muted-foreground">{t('panel.noTasks')}</p>
      )}
      <div>
        <Button variant="outline" size="xs" onClick={() => setOpen(true)}>
          <ClipboardPlus aria-hidden />
          {t('item.addTask')}
        </Button>
      </div>
      <TaskDialog subject={open ? subject : null} onOpenChange={setOpen} />
    </div>
  );
}

/**
 * Puts a reply drafted on Today (`lib/pending-reply-draft`, in memory) into the composer of its
 * conversation. Rendered among the composer tools, which hand it the composer's `insertText`.
 * The draft is dropped from the store only once the composer holds it; when the composer refuses
 * it (a send is running, or the text would be too long) it waits for the next time the
 * conversation is opened.
 */
export function DraftPrefill({
  conversationId,
  insertText,
}: {
  conversationId: string;
  insertText: (text: string) => boolean;
}) {
  const ws = useWorkspaceId();
  // Once per conversation shown: `insertText` changes every render and a refusal toasts.
  const tried = useRef<string | null>(null);
  useEffect(() => {
    if (tried.current === conversationId) return;
    tried.current = conversationId;
    const draft = peekPendingDraft(ws, conversationId);
    if (draft && insertText(draft)) takePendingDraft(ws, conversationId, draft);
  }, [ws, conversationId, insertText]);
  return null;
}
