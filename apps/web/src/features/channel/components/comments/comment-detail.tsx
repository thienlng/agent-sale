import type { FanpageComment, FanpageCommentSource } from '@agent-sales/contracts';
import { ArrowLeft, ExternalLink, EyeOff, Eye } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/format';
import { useCan } from '@/lib/permissions';
import { useSession } from '@/lib/session';
import { useWorkspaceId } from '@/lib/use-workspace';
import { useCommentActions, useCommentDetail, useCommentSource } from '../../api/fanpage-comments';
import {
  history,
  pendingModeration,
  postLink,
  sentPrivateReply,
  shortId,
  visibility,
} from '../../lib/comment-state';
import { moderate, reconcileModeration } from '../../lib/comment-send';
import {
  moderationKey,
  moderationOpen,
  settleModeration,
  useModeration,
  type ModerationKind,
} from '../../lib/moderation-attempts';
import { CommentComposer } from './comment-composer';
import { State, commentsT, type FacebookPage, type PostLabel } from './comments-shared';

export function CommentDetail({
  page,
  usable,
  commentId,
  posts,
  onBack,
}: {
  page: FacebookPage;
  usable: boolean;
  commentId: string;
  posts: PostLabel[];
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string, o?: Record<string, unknown>) => t(`${commentsT}.${key}`, o ?? {});
  const detail = useCommentDetail(page.id, commentId);
  const source = useCommentSource(page.id, commentId);
  const canAct = useCan('contacts.edit');
  const back = (
    <Button variant="ghost" size="sm" className="md:hidden" onClick={onBack}>
      <ArrowLeft aria-hidden />
      {tr('back')}
    </Button>
  );
  if (detail.isPending)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="p-2">{back}</div>
        <State title={tr('loading')} busy />
      </div>
    );
  if (detail.isError && !detail.data)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="p-2">{back}</div>
        <State title={tr('detailError')} alert>
          <Button variant="outline" className="mt-4" onClick={() => void detail.refetch()}>
            {tr('retry')}
          </Button>
        </State>
      </div>
    );
  const c = detail.data.data;
  const fresh = source.data?.status === 'fresh' ? source.data : null;
  const stale = fresh ? !fresh.matchesStored : false;
  const parentText = fresh?.parentText || c.context?.parentText || detail.data.parent?.text || null;
  const privateSent = sentPrivateReply(c);
  const postLabel = posts.find((p) => p.postId === c.postId)?.label;
  return (
    <article className="flex min-h-0 flex-1 flex-col" aria-label={tr('detailLabel')}>
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        {back}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">
            {tr('author', { id: shortId(c.authorId) })}
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            {tr('onPage', { page: page.name })} · {formatDateTime(c.occurredAt)}
          </p>
        </div>
        <Moderation page={page} comment={c} disabled={!usable || !canAct || c.deleted || stale} />
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <SourceCard
          comment={c}
          source={source.data}
          loading={source.isPending}
          failed={source.isError}
          {...(postLabel ? { label: postLabel } : {})}
        />
        {c.parentId ? (
          <section className="rounded-lg border p-3 text-sm">
            <p className="text-xs text-muted-foreground">{tr('parent')}</p>
            <p className="mt-1 whitespace-pre-wrap break-words">
              {parentText || tr('parentUnknown')}
            </p>
          </section>
        ) : null}
        <section className="rounded-lg border border-primary/30 bg-primary/5 p-3">
          <p className="text-xs text-muted-foreground">{tr('selectedComment')}</p>
          <p
            className={
              c.text ? 'mt-1 whitespace-pre-wrap break-words' : 'mt-1 italic text-muted-foreground'
            }
          >
            {c.text || tr('noText')}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {c.deleted ? <Badge variant="destructive">{tr('deletedLong')}</Badge> : null}
            {c.needsReview && !c.deleted ? (
              <Badge variant="secondary">{tr('reviewLong')}</Badge>
            ) : null}
            <VisibilityBadge comment={c} />
          </div>
          {stale ? (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {tr('changedOnFacebook')}
            </p>
          ) : null}
        </section>
        <History comment={c} />
        {privateSent ? (
          <p role="status" className="rounded-lg bg-muted p-3 text-sm">
            {tr('privateSentNote')}
          </p>
        ) : null}
      </div>
      {canAct ? (
        <CommentComposer
          page={page}
          comment={c}
          disabledReason={
            c.deleted
              ? tr('blocked.deleted')
              : !usable
                ? tr('blocked.reconnect')
                : stale
                  ? tr('blocked.changed')
                  : null
          }
        />
      ) : (
        <p className="shrink-0 border-t p-3 text-sm text-muted-foreground">{tr('viewOnly')}</p>
      )}
    </article>
  );
}

function VisibilityBadge({ comment }: { comment: FanpageComment }) {
  const { t } = useTranslation();
  const shown = visibility(comment);
  if (shown === 'visible') return null;
  return <Badge variant="outline">{t(`${commentsT}.visibility.${shown}`)}</Badge>;
}

function SourceCard({
  comment: c,
  source,
  loading,
  failed,
  label,
}: {
  comment: FanpageComment;
  source: FanpageCommentSource | undefined;
  loading: boolean;
  failed: boolean;
  label?: string;
}) {
  const { t } = useTranslation();
  const tr = (key: string, o?: Record<string, unknown>) => t(`${commentsT}.${key}`, o ?? {});
  const fresh = source?.status === 'fresh' ? source.post : null;
  // A fresh read wins; otherwise the snapshot captured when the comment was last verified.
  const post = fresh ?? c.context;
  const freshness = fresh
    ? tr('sourceFresh', { time: formatDateTime(fresh.fetchedAt) })
    : c.context
      ? tr('sourceSnapshot', { time: formatDateTime(c.context.fetchedAt) })
      : null;
  const reason =
    source?.status === 'unavailable'
      ? tr(`sourceReason.${source.reason}`)
      : failed
        ? tr('sourceReason.provider')
        : null;
  return (
    <section className="rounded-lg border bg-muted/40 p-3 text-sm" aria-label={tr('source')}>
      <div className="flex items-center gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label ?? tr('source')}</p>
        <a
          className="ml-auto inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
          href={postLink(c.postId, post?.permalink)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {tr('openPost')}
          <ExternalLink className="size-3" aria-hidden />
        </a>
      </div>
      {loading && !post ? (
        <p className="mt-1 text-muted-foreground">{tr('sourceLoading')}</p>
      ) : post ? (
        <>
          {post.text ? (
            <p className="mt-1 line-clamp-6 whitespace-pre-wrap break-words">{post.text}</p>
          ) : (
            <p className="mt-1 italic text-muted-foreground">{tr('mediaOnly')}</p>
          )}
          {post.media.some((m) => m.title || m.description) ? (
            <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
              {post.media.map((m, i) =>
                m.title || m.description ? <li key={i}>{m.title || m.description}</li> : null,
              )}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="mt-1 text-muted-foreground">{tr('sourceNone')}</p>
      )}
      {freshness ? <p className="mt-2 text-xs text-muted-foreground">{freshness}</p> : null}
      {reason ? <p className="mt-1 text-xs text-muted-foreground">{reason}</p> : null}
    </section>
  );
}

function History({ comment }: { comment: FanpageComment }) {
  const { t } = useTranslation();
  const tr = (key: string, o?: Record<string, unknown>) => t(`${commentsT}.${key}`, o ?? {});
  const actions = history(comment);
  return (
    <section aria-label={tr('history')}>
      <p className="text-xs font-medium text-muted-foreground">{tr('history')}</p>
      <p className="text-xs text-muted-foreground">{tr('historyScope')}</p>
      {actions.length ? (
        <ol className="mt-2 space-y-2">
          {actions.map((a) => (
            <li key={a.id} className="rounded-lg border p-2 text-sm">
              <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{tr(`kind.${a.kind}`)}</span>
                <Badge variant={a.status === 'sent' ? 'secondary' : 'outline'}>
                  {tr(`status.${a.status}`)}
                </Badge>
                <span>
                  {a.actorId
                    ? tr('byStaff')
                    : a.reason.startsWith('Configured keyword')
                      ? tr('byKeyword')
                      : tr('byBot')}
                </span>
                <time className="ml-auto" dateTime={a.createdAt}>
                  {formatDateTime(a.createdAt)}
                </time>
              </p>
              {a.text ? <p className="mt-1 whitespace-pre-wrap break-words">{a.text}</p> : null}
              {a.status === 'unknown' || a.status === 'pending' ? (
                <p className="mt-1 text-xs text-muted-foreground">{tr('inspect')}</p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">{tr('noHistory')}</p>
      )}
    </section>
  );
}

/**
 * Hide / unhide with a recorded outcome; an uncertain result is shown as such, never as done.
 * While an attempt may still reach Facebook only its retry (same request id) or a status check
 * is offered, never the opposite operation.
 */
function Moderation({
  page,
  comment: c,
  disabled,
}: {
  page: FacebookPage;
  comment: FanpageComment;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const tr = (key: string, o?: Record<string, unknown>) => t(`${commentsT}.${key}`, o ?? {});
  const ws = useWorkspaceId();
  const userId = useSession()?.user.id ?? '';
  const actions = useCommentActions();
  const key = moderationKey({
    userId,
    workspaceId: ws,
    connectionId: page.id,
    commentId: c.commentId,
  });
  const attempt = useModeration(key);
  const open = moderationOpen(attempt);
  const sending = attempt?.state === 'sending';
  const where = { workspaceId: ws, page: page.id, commentId: c.commentId };
  const shown = visibility(c);
  const kind = shown === 'hidden' ? 'unhide' : 'hide';
  // A stored hide/unhide still pending (another tab, before a reload): the opposite operation
  // could race it, so it needs an explicit confirmation.
  const stored = open ? null : pendingModeration(c);
  const [confirming, setConfirming] = useState<ModerationKind | null>(null);
  const run = (next: ModerationKind) => {
    if (stored && next !== stored.kind && confirming !== next) {
      setConfirming(next);
      return;
    }
    setConfirming(null);
    void moderate(actions, key, next, { ...where, version: c.version });
  };
  const notice =
    attempt && !sending
      ? tr(`moderation.${attempt.state}`)
      : stored
        ? tr('moderation.pending')
        : null;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        {open && attempt ? (
          <>
            {!sending ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void reconcileModeration(actions, key, attempt.requestId, where)}
              >
                {tr('checkStatus')}
              </Button>
            ) : null}
            {attempt.state === 'pending' ? (
              // Never final (the server stopped mid-call): release it as unknown, not as done.
              <Button
                size="sm"
                variant="ghost"
                onClick={() => settleModeration(key, attempt.requestId, 'unknown')}
              >
                {tr('stopWaiting')}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              disabled={disabled || sending}
              onClick={() => run(attempt.kind)}
            >
              {attempt.kind === 'hide' ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              {sending ? tr('working') : `${tr('moderation.retry')}: ${tr(attempt.kind)}`}
            </Button>
          </>
        ) : shown === 'uncertain' ? (
          <>
            <Button size="sm" variant="outline" disabled={disabled} onClick={() => run('hide')}>
              <EyeOff aria-hidden />
              {tr('hide')}
            </Button>
            <Button size="sm" variant="outline" disabled={disabled} onClick={() => run('unhide')}>
              <Eye aria-hidden />
              {tr('unhide')}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => run(kind)}>
            {kind === 'hide' ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
            {tr(kind)}
          </Button>
        )}
      </div>
      {notice ? (
        <p role="alert" className="max-w-56 text-right text-xs text-destructive">
          {notice}
        </p>
      ) : null}
      {confirming && stored ? (
        <div
          role="alert"
          className="max-w-64 space-y-2 rounded-md border border-destructive/40 p-2 text-xs"
        >
          <p>{tr('moderation.opposite', { action: tr(stored.kind) })}</p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="destructive" onClick={() => run(confirming)}>
              {tr(confirming)}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirming(null)}>
              {tr('resendCancel')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
