import { useSyncExternalStore } from 'react';
import type { AttemptState } from './comment-drafts';

/**
 * Hide / unhide attempts for this tab, one per comment (keyed like reply drafts, without the
 * mode). While an attempt may still reach Facebook it keeps its request id, a retry reuses it,
 * and the opposite operation is refused so the two never race. Memory only.
 */
export type ModerationKind = 'hide' | 'unhide';
export interface ModerationAttempt {
  requestId: string;
  kind: ModerationKind;
  state: AttemptState;
}
export interface ModerationScope {
  userId: string;
  workspaceId: string;
  connectionId: string;
  commentId: string;
}

const attempts = new Map<string, ModerationAttempt>();
const listeners = new Set<() => void>();

export const moderationKey = (s: ModerationScope) =>
  [s.userId, s.workspaceId, s.connectionId, s.commentId].join('/');

/** States in which the first request may still go out: same id, no opposite operation. */
export const moderationOpen = (a: ModerationAttempt | null) =>
  a?.state === 'sending' || a?.state === 'unconfirmed' || a?.state === 'pending';

function write(key: string, next: ModerationAttempt | null) {
  if (next) attempts.set(key, next);
  else attempts.delete(key);
  listeners.forEach((l) => l());
}
export function readModeration(key: string): ModerationAttempt | null {
  return attempts.get(key) ?? null;
}
/**
 * Starts `kind`. An open attempt of the same kind is retried under its request id; an open
 * attempt of the other kind, or one already in flight, refuses the start (returns null).
 */
export function beginModeration(
  key: string,
  kind: ModerationKind,
  newId: () => string = () => crypto.randomUUID(),
): ModerationAttempt | null {
  const current = readModeration(key);
  if (current?.state === 'sending') return null;
  if (moderationOpen(current) && current?.kind !== kind) return null;
  const attempt: ModerationAttempt = {
    requestId: moderationOpen(current) && current ? current.requestId : newId(),
    kind,
    state: 'sending',
  };
  write(key, attempt);
  return attempt;
}
/** Records an outcome for its own request id only; a confirmed operation leaves nothing open. */
export function settleModeration(key: string, requestId: string, state: AttemptState | 'sent') {
  const current = readModeration(key);
  if (current?.requestId !== requestId) return;
  write(key, state === 'sent' ? null : { ...current, state });
}
export function clearModeration() {
  attempts.clear();
  listeners.forEach((l) => l());
}
export function useModeration(key: string): ModerationAttempt | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => readModeration(key),
  );
}
