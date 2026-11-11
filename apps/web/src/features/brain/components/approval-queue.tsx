import type { TodayApprovalItem, TodayApprovalQueue } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { Clock, Loader2, PenLine, Send, X } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ApiClientError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import { useApproveAllDrafts, useApproveDraft, useRejectDraft } from '../api/care';
import { CHANNELS, CustomerInitial } from './today-item';

/** The care agent writes at most this much; an edit keeps to it too (spec §4). */
export const DRAFT_MAX = 600;

/** "còn 3 giờ" / "còn 25 phút" before the 24-hour window closes. */
function useTimeLeft() {
  const { t } = useTranslation('brain');
  return (closesAt: string, now: number) => {
    const minutes = Math.max(1, Math.floor((Date.parse(closesAt) - now) / 60_000));
    return minutes >= 60
      ? t('approval.leftHours', { count: Math.floor(minutes / 60) })
      : t('approval.leftMinutes', { count: minutes });
  };
}

/** What a failed approval means for the member. */
function useApprovalError() {
  const { t } = useTranslation('brain');
  return (e: Error) =>
    toast.error(
      e instanceof ApiClientError && (e.status === 409 || e.status === 404)
        ? t('approval.gone')
        : t('approval.failed'),
    );
}

/**
 * "Chờ duyệt" (spec 2026-11-11 care §5): the follow-ups the care agent drafted at level
 * "đề xuất". Each can be sent as is, edited then sent, or dropped; "Gửi tất cả" sends the lot
 * after a confirm. Expired drafts (the window closed) are already filtered out by the page.
 * Write actions need `contacts.edit`; others read the drafts only.
 */
export function ApprovalQueue({
  queue,
  now,
  canAct,
}: {
  queue: TodayApprovalQueue;
  now: number;
  canAct: boolean;
}) {
  const { t } = useTranslation('brain');
  const headingId = `today-queue-${queue.key}`;
  const all = useApproveAllDrafts();
  const onError = useApprovalError();
  const ids = queue.items.map((i) => i.careMessageId);

  function sendAll() {
    all.mutate(ids, {
      onSuccess: (r) =>
        r.notSent > 0
          ? toast.warning(t('approval.sentAllPartial', { count: r.sent, notSent: r.notSent }))
          : toast.success(t('approval.sentAll', { count: r.sent })),
      onError,
    });
  }

  return (
    <section
      aria-labelledby={headingId}
      id={`queue-${queue.key}`}
      className="flex min-w-0 scroll-mt-20 flex-col overflow-hidden rounded-xl border bg-card lg:col-span-2"
    >
      <header className="flex min-h-12 items-center gap-3 border-b px-4 py-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 items-center gap-2">
            <h2 id={headingId} className="min-w-0 truncate text-sm font-semibold">
              {t('queues.approval.title')}
            </h2>
            <span
              className={cn(
                'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums',
                queue.count > 0
                  ? 'bg-primary-soft text-brand-text'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              <span aria-hidden>{queue.count}</span>
              <span className="sr-only">{t('today.countLabel', { count: queue.count })}</span>
            </span>
          </div>
          <p className="hidden truncate text-xs text-muted-foreground sm:block">
            {t('approval.subtitle')}
          </p>
        </div>
        {canAct && ids.length > 1 ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="outline" className="shrink-0" disabled={all.isPending}>
                {all.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Send aria-hidden />
                )}
                {t('approval.sendAll')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t('approval.sendAllTitle', { count: ids.length })}
                </AlertDialogTitle>
                <AlertDialogDescription>{t('approval.sendAllDescription')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('approval.cancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={sendAll}>
                  {t('approval.sendAllConfirm', { count: ids.length })}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </header>
      {queue.items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">{t('queues.approval.empty')}</p>
      ) : (
        <ul className="divide-y">
          {queue.items.map((item) => (
            <ApprovalRow key={item.careMessageId} item={item} now={now} canAct={canAct} />
          ))}
        </ul>
      )}
      {queue.count > queue.items.length ? (
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">
          {t('today.more', { count: queue.count - queue.items.length })}
        </p>
      ) : null}
    </section>
  );
}

function ApprovalRow({
  item,
  now,
  canAct,
}: {
  item: TodayApprovalItem;
  now: number;
  canAct: boolean;
}) {
  const { t } = useTranslation('brain');
  const timeLeft = useTimeLeft();
  const onError = useApprovalError();
  const approve = useApproveDraft();
  const reject = useRejectDraft();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const editorId = useId();
  const busy = approve.isPending || reject.isPending;
  const urgent =
    item.windowClosesAt !== null && Date.parse(item.windowClosesAt) - now < 2 * 3_600_000;
  const trimmed = text.trim();

  function send(edited?: string) {
    approve.mutate(
      { id: item.careMessageId, text: edited },
      {
        onSuccess: (r) =>
          r.status === 'sent'
            ? toast.success(t('approval.sent', { name: item.customerName }))
            : toast.warning(t('approval.notSent')),
        onError,
      },
    );
  }

  return (
    <li className="flex gap-3 px-4 py-3">
      <CustomerInitial name={item.customerName} url={item.avatarUrl} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            to="/app/inbox"
            search={{ conversation: item.conversationId }}
            className="min-w-0 max-w-full truncate font-medium hover:underline"
          >
            {item.customerName}
          </Link>
          <span className="shrink-0 text-xs text-muted-foreground">
            {t(`channel.${CHANNELS.has(item.channel) ? item.channel : 'other'}`)}
          </span>
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {t(`care.template.${item.template}`)}
          </span>
          {item.windowClosesAt ? (
            <span
              className={cn(
                'ml-auto inline-flex shrink-0 items-center gap-1 text-xs tabular-nums',
                urgent ? 'font-medium text-warning' : 'text-muted-foreground',
              )}
              title={t('approval.windowHint')}
            >
              <Clock className="size-3.5" aria-hidden />
              {timeLeft(item.windowClosesAt, now)}
            </span>
          ) : null}
        </div>
        {editing ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={editorId} className="sr-only">
              {t('approval.editLabel', { name: item.customerName })}
            </label>
            <Textarea
              id={editorId}
              value={text}
              maxLength={DRAFT_MAX}
              rows={4}
              autoFocus
              onChange={(e) => setText(e.target.value)}
              className="min-h-24 text-sm"
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground tabular-nums">
                {t('approval.chars', { count: text.length, max: DRAFT_MAX })}
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    setText(item.text);
                    setEditing(false);
                  }}
                >
                  {t('approval.cancel')}
                </Button>
                <Button
                  size="xs"
                  disabled={busy || trimmed.length === 0 || text.length > DRAFT_MAX}
                  onClick={() => send(trimmed === item.text.trim() ? undefined : trimmed)}
                >
                  <Send aria-hidden />
                  {t('approval.send')}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm whitespace-pre-wrap break-words">
            {item.text}
          </p>
        )}
        {canAct && !editing ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="xs" disabled={busy} onClick={() => send()}>
              {approve.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Send aria-hidden />
              )}
              {t('approval.send')}
            </Button>
            <Button size="xs" variant="outline" disabled={busy} onClick={() => setEditing(true)}>
              <PenLine aria-hidden />
              {t('approval.edit')}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                reject.mutate(item.careMessageId, {
                  onSuccess: () => toast.success(t('approval.rejected')),
                  onError,
                })
              }
            >
              <X aria-hidden />
              {t('approval.reject')}
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}
