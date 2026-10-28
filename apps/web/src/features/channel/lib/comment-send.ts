import type { FanpageAction, FanpageCommentDetail } from '@agent-sales/contracts';
import { ApiClientError } from '@/lib/api-client';
import type { ActionRequest } from '../api/fanpage-comments';
import { beginAttempt, settleAttempt, type AttemptState } from './comment-drafts';
import { beginModeration, settleModeration, type ModerationKind } from './moderation-attempts';

export interface SendDeps {
  send: (r: ActionRequest) => Promise<{ action: FanpageAction | null }>;
  reload: (workspaceId: string, page: string, commentId: string) => Promise<FanpageCommentDetail>;
}
type Outcome = AttemptState | 'sent';

/** A recorded `pending` stays open (same id, locked) until the record reaches a final status. */
export const fromStatus = (status: FanpageAction['status']): Outcome =>
  status === 'sent'
    ? 'sent'
    : status === 'failed' || status === 'cancelled'
      ? 'failed'
      : status === 'pending'
        ? 'pending'
        : 'unknown';

/**
 * No answer, or a server error after which a reservation may exist: retry with the same id.
 * UNAVAILABLE (Page must reconnect, Facebook did not answer the source check) is raised before
 * anything is reserved, so it is a plain refusal.
 */
const unanswered = (error: unknown) =>
  !(error instanceof ApiClientError) || (error.status >= 500 && error.code !== 'UNAVAILABLE');

/**
 * The outcome of one request id. A missing action in the answer is not a success: the stored
 * record is read again and matched by request id.
 */
export async function runAction(
  deps: SendDeps,
  request: ActionRequest,
): Promise<{ outcome: Outcome; code?: string }> {
  try {
    const { action } = await deps.send(request);
    if (action) return { outcome: fromStatus(action.status) };
  } catch (error) {
    if (unanswered(error)) return { outcome: 'unconfirmed' };
    return { outcome: 'rejected', code: (error as ApiClientError).code };
  }
  try {
    const detail = await deps.reload(request.workspaceId, request.page, request.commentId);
    const match = detail.data.actions.find((a) => a.id === request.requestId);
    return { outcome: match ? fromStatus(match.status) : 'unmatched' };
  } catch {
    return { outcome: 'unconfirmed' };
  }
}

/** Sends the draft under `key`; the result settles that draft only, wherever the user is now. */
export async function sendDraft(
  deps: SendDeps,
  key: string,
  request: Omit<ActionRequest, 'requestId' | 'text'>,
) {
  const attempt = beginAttempt(key);
  if (!attempt || !attempt.text) return;
  const { outcome, code } = await runAction(deps, {
    ...request,
    requestId: attempt.requestId,
    text: attempt.text,
  });
  settleAttempt(key, attempt.requestId, outcome, code);
}

/** Re-reads the stored record and adopts the recorded outcome of an unconfirmed or pending attempt. */
export async function reconcileDraft(
  deps: SendDeps,
  key: string,
  requestId: string,
  where: { workspaceId: string; page: string; commentId: string },
) {
  try {
    const detail = await deps.reload(where.workspaceId, where.page, where.commentId);
    const match = detail.data.actions.find((a) => a.id === requestId);
    // Nothing recorded yet: the attempt stays unconfirmed, and a retry reuses its id.
    if (match) settleAttempt(key, requestId, fromStatus(match.status));
  } catch {
    // still unconfirmed
  }
}

/** Hides or unhides under the comment's moderation attempt; refused while the other is open. */
export async function moderate(
  deps: SendDeps,
  key: string,
  kind: ModerationKind,
  request: { workspaceId: string; page: string; commentId: string; version: string },
) {
  const attempt = beginModeration(key, kind);
  if (!attempt) return null;
  const { outcome } = await runAction(deps, {
    ...request,
    kind,
    text: '',
    requestId: attempt.requestId,
  });
  settleModeration(key, attempt.requestId, outcome);
  return outcome;
}

/** Re-reads the stored record and adopts the recorded outcome of an open moderation attempt. */
export async function reconcileModeration(
  deps: SendDeps,
  key: string,
  requestId: string,
  where: { workspaceId: string; page: string; commentId: string },
) {
  try {
    const detail = await deps.reload(where.workspaceId, where.page, where.commentId);
    const match = detail.data.actions.find((a) => a.id === requestId);
    if (match) settleModeration(key, requestId, fromStatus(match.status));
  } catch {
    // still open
  }
}
