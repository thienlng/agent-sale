import type { FanpageComment } from '@agent-sales/contracts';
import { exposesContactDetails } from '@agent-sales/shared';
import { Lock, MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useSession } from '@/lib/session';
import { useWorkspaceId } from '@/lib/use-workspace';
import { cn } from '@/lib/utils';
import { useCommentActions } from '../../api/fanpage-comments';
import {
  draftKey,
  isLocked,
  setDraftText,
  useDraft,
  type ReplyMode,
} from '../../lib/comment-drafts';
import { reconcileDraft, sendDraft } from '../../lib/comment-send';
import { privateReplyState, shortId } from '../../lib/comment-state';
import { commentsT, type FacebookPage } from './comments-shared';

const MAX = 2000;

/**
 * Public reply or private message for one comment. Each mode has its own draft; Enter adds a
 * new line and only the Send button sends. Changing mode never sends anything.
 */
export function CommentComposer({
  page,
  comment: c,
  disabledReason,
}: {
  page: FacebookPage;
  comment: FanpageComment;
  disabledReason: string | null;
}) {
  const { t } = useTranslation();
  const tr = (key: string, o?: Record<string, unknown>) => t(`${commentsT}.${key}`, o ?? {});
  const ws = useWorkspaceId();
  const userId = useSession()?.user.id ?? '';
  const actions = useCommentActions();
  const [mode, setMode] = useState<ReplyMode>('public_reply');
  const [confirming, setConfirming] = useState(false);
  // After an unknown or unmatched outcome a new request may duplicate the reply: ask first.
  const [resending, setResending] = useState(false);
  const key = draftKey({
    userId,
    workspaceId: ws,
    connectionId: page.id,
    commentId: c.commentId,
    mode,
  });
  const draft = useDraft(key);
  const attempt = draft.attempt;
  const locked = isLocked(draft);
  const privateState = privateReplyState(c, Date.now());
  // Private replies are once-only: after any recorded attempt only an unconfirmed retry remains.
  const blocked =
    disabledReason ??
    (mode === 'private_reply' && privateState !== 'available' && !locked
      ? tr(`private.${privateState}`)
      : null);
  const text = draft.text;
  const tooLong = text.length > MAX;
  const author = tr('author', { id: shortId(c.authorId) });
  const where = { workspaceId: ws, page: page.id, commentId: c.commentId };
  function send(confirmPublicContact = false, confirmResend = false) {
    const uncertain = attempt?.state === 'unknown' || attempt?.state === 'unmatched';
    if (uncertain && !confirmResend) {
      setResending(true);
      return;
    }
    setResending(false);
    if (mode === 'public_reply' && !confirmPublicContact && exposesContactDetails(text)) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    void sendDraft(actions, key, {
      ...where,
      kind: mode,
      version: c.version,
      confirmPublicContact,
    });
  }
  return (
    <div className="shrink-0 space-y-2 border-t p-3">
      <div className="flex gap-1" role="group" aria-label={tr('mode')}>
        {(['public_reply', 'private_reply'] as const).map((m) => (
          <Button
            key={m}
            type="button"
            size="sm"
            variant={mode === m ? 'default' : 'outline'}
            aria-pressed={mode === m}
            onClick={() => {
              setMode(m);
              setConfirming(false);
              setResending(false);
            }}
          >
            {m === 'public_reply' ? <MessageCircle aria-hidden /> : <Lock aria-hidden />}
            {tr(`kind.${m}`)}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground" id={`${key}-target`}>
        {mode === 'public_reply'
          ? tr('target.public', { page: page.name, author })
          : tr('target.private', { page: page.name, author })}
      </p>
      {blocked ? (
        <p role="status" className="rounded-md bg-muted p-2 text-sm">
          {blocked}
        </p>
      ) : (
        <>
          <Textarea
            aria-label={tr(`composer.${mode}`)}
            aria-describedby={`${key}-target`}
            value={text}
            readOnly={locked}
            onChange={(e) => {
              setConfirming(false);
              setResending(false);
              setDraftText(key, e.target.value);
            }}
            placeholder={tr(`composer.${mode}`)}
            className={cn('max-h-48 min-h-20', mode === 'private_reply' && 'border-dashed')}
          />
          <AttemptStatus
            state={attempt?.state ?? null}
            code={attempt?.code}
            mode={mode}
            sent={Boolean(draft.sentAt)}
          />
          {resending ? (
            <div
              role="alert"
              className="space-y-2 rounded-md border border-destructive/40 p-2 text-sm"
            >
              <p>{tr('resendWarning')}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="destructive" onClick={() => send(false, true)}>
                  {tr('resendConfirm')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setResending(false)}>
                  {tr('resendCancel')}
                </Button>
              </div>
            </div>
          ) : null}
          {confirming ? (
            <div
              role="alert"
              className="space-y-2 rounded-md border border-destructive/40 p-2 text-sm"
            >
              <p>{tr('contactWarning')}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="destructive" onClick={() => send(true, true)}>
                  {tr('contactConfirm')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setMode('private_reply')}>
                  {tr('contactPrivate')}
                </Button>
              </div>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <span className={cn('text-xs text-muted-foreground', tooLong && 'text-destructive')}>
              {text.length}/{MAX}
            </span>
            {attempt?.state === 'unconfirmed' ? (
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                onClick={() => void reconcileDraft(actions, key, attempt.requestId, where)}
              >
                {tr('checkStatus')}
              </Button>
            ) : null}
            <Button
              size="sm"
              className={attempt?.state === 'unconfirmed' ? '' : 'ml-auto'}
              disabled={!text.trim() || tooLong || attempt?.state === 'sending'}
              onClick={() => send()}
            >
              {attempt?.state === 'sending'
                ? tr('sending')
                : attempt?.state === 'unconfirmed'
                  ? tr('retrySame')
                  : attempt?.state === 'unknown' || attempt?.state === 'unmatched'
                    ? tr('sendAgain')
                    : tr(`send.${mode}`)}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

const KNOWN_REFUSALS = ['CONFLICT', 'FORBIDDEN', 'VALIDATION_FAILED', 'NOT_FOUND', 'UNAVAILABLE'];
function AttemptStatus({
  state,
  code,
  mode,
  sent,
}: {
  state: string | null;
  code: string | undefined;
  mode: ReplyMode;
  sent: boolean;
}) {
  const { t } = useTranslation();
  if (sent && !state)
    return (
      <p role="status" className="text-xs text-muted-foreground">
        {t(`${commentsT}.attempt.sent.${mode}`)}
      </p>
    );
  if (!state || state === 'sending') return null;
  const message =
    state === 'rejected' && code && KNOWN_REFUSALS.includes(code)
      ? `attempt.refused.${code}`
      : `attempt.${state}`;
  return (
    <p role="alert" className="text-xs text-destructive">
      {t(`${commentsT}.${message}`)}
    </p>
  );
}
