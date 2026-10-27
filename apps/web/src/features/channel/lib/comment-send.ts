import type { FanpageAction, FanpageCommentDetail } from '@agent-sales/contracts';
import { ApiClientError } from '@/lib/api-client';
import type { ActionRequest } from '../api/fanpage-comments';
import { beginAttempt, settleAttempt, type AttemptState } from './comment-drafts';

export interface SendDeps {
  send: (r: ActionRequest) => Promise<{ action: FanpageAction | null }>;
  reload: (workspaceId: string, page: string, commentId: string) => Promise<FanpageCommentDetail>;
}
type Outcome = AttemptState | 'sent';

const fromStatus = (status: FanpageAction['status']): Outcome =>
  status === 'sent' ? 'sent' : status === 'failed' || status === 'cancelled' ? 'failed' : 'unknown';

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

/** Re-reads the stored record and adopts the recorded outcome of an unconfirmed attempt. */
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
