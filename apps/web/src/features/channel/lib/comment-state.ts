import type { FanpageAction, FanpageComment } from '@agent-sales/contracts';

/** What the Page shows for a comment, derived only from recorded hide/unhide outcomes. */
export type Visibility = 'visible' | 'hidden' | 'uncertain';

const byTime = (a: FanpageAction, b: FanpageAction) => a.createdAt.localeCompare(b.createdAt);

/**
 * The newest hide/unhide that may have reached Facebook decides. A pending or unknown one is
 * uncertain: it is never shown as done until a recorded outcome says so.
 */
export function visibility(comment: Pick<FanpageComment, 'actions'>): Visibility {
  const moderation = comment.actions
    .filter((a) => a.kind === 'hide' || a.kind === 'unhide')
    .filter((a) => a.status !== 'failed' && a.status !== 'cancelled')
    .sort(byTime);
  const last = moderation.at(-1);
  if (!last) return 'visible';
  if (last.status !== 'sent') return 'uncertain';
  return last.kind === 'hide' ? 'hidden' : 'visible';
}

export type PrivateReplyState = 'available' | 'deleted' | 'attempted' | 'expired';
const PRIVATE_WINDOW_MS = 7 * 86400000;

/** Mirrors the server: one private reply per comment, within seven days of the comment. */
export function privateReplyState(
  comment: Pick<FanpageComment, 'deleted' | 'occurredAt' | 'actions'>,
  now: number,
): PrivateReplyState {
  if (comment.deleted) return 'deleted';
  if (
    comment.actions.some(
      (a) => a.kind === 'private_reply' && a.status !== 'failed' && a.status !== 'cancelled',
    )
  )
    return 'attempted';
  return now - Date.parse(comment.occurredAt) >= PRIVATE_WINDOW_MS ? 'expired' : 'available';
}

/** Recorded actions, oldest first: the local history, not Facebook's full reply thread. */
export function history(comment: Pick<FanpageComment, 'actions'>): FanpageAction[] {
  return [...comment.actions].sort(byTime);
}

/** The latest private reply that Facebook accepted, if any. */
export function sentPrivateReply(comment: Pick<FanpageComment, 'actions'>) {
  return history(comment)
    .filter((a) => a.kind === 'private_reply' && a.status === 'sent')
    .at(-1);
}

/** Only links to the Page's own post on facebook.com, built from validated ids or permalinks. */
export function postLink(postId: string, permalink?: string | null): string {
  if (permalink) {
    try {
      const url = new URL(permalink);
      if (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        /(^|\.)facebook\.com$/.test(url.hostname)
      )
        return url.href;
    } catch {
      // fall back to the id-based link
    }
  }
  return `https://www.facebook.com/${encodeURIComponent(postId)}`;
}

/** The commenter's external id, shortened; Facebook does not give us a reliable name. */
export function shortId(externalId: string): string {
  return externalId.length > 6 ? `…${externalId.slice(-6)}` : externalId;
}
