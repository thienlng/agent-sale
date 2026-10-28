import { useSyncExternalStore } from 'react';

/**
 * Comment reply drafts and send attempts for this tab, keyed by user, workspace, Page, comment
 * and mode, so a public and a private draft never mix and a late answer only settles its own
 * attempt. Memory only: nothing is written to browser storage, and a reload starts clean.
 */
export type ReplyMode = 'public_reply' | 'private_reply';
export type AttemptState =
  /** Request in flight. */
  | 'sending'
  /** No answer (network/5xx): retry with the same request id; the text stays locked. */
  | 'unconfirmed'
  /** Recorded and still running on the server: only its status may be checked; same id, locked. */
  | 'pending'
  /** Facebook's outcome is unknown: check Facebook before sending again. */
  | 'unknown'
  /** Facebook rejected it or it was cancelled before sending; a new attempt is allowed. */
  | 'failed'
  /** The server refused it (validation, permission, stale source). */
  | 'rejected'
  /** The server recorded nothing for this request id: review the history before retrying. */
  | 'unmatched';
export interface Attempt {
  requestId: string;
  text: string;
  state: AttemptState;
  /** Server error code for a refusal, when known. */
  code?: string;
}
export interface Draft {
  text: string;
  attempt: Attempt | null;
  /** Set when this draft's last attempt was confirmed sent; cleared by the next edit. */
  sentAt: number | null;
}
export interface DraftScope {
  userId: string;
  workspaceId: string;
  connectionId: string;
  commentId: string;
  mode: ReplyMode;
}

const EMPTY: Draft = { text: '', attempt: null, sentAt: null };
const drafts = new Map<string, Draft>();
const listeners = new Set<() => void>();

export const draftKey = (s: DraftScope) =>
  [s.userId, s.workspaceId, s.connectionId, s.commentId, s.mode].join('/');

function write(key: string, next: Draft) {
  if (!next.text && !next.attempt && !next.sentAt) drafts.delete(key);
  else drafts.set(key, next);
  listeners.forEach((l) => l());
}
export function readDraft(key: string): Draft {
  return drafts.get(key) ?? EMPTY;
}
/** Edits are ignored while an attempt is in flight or unconfirmed (its text must not change). */
export function setDraftText(key: string, text: string) {
  const current = readDraft(key);
  if (isLocked(current)) return;
  write(key, { ...current, text, sentAt: null });
}
/** States that keep their request id: the first request may still go out. */
export const isOpen = (state: AttemptState | undefined) =>
  state === 'sending' || state === 'unconfirmed' || state === 'pending';
export const isLocked = (d: Draft) => isOpen(d.attempt?.state);

/**
 * Starts an attempt. An unconfirmed or pending attempt is retried with the same request id, so
 * the server recognises it instead of sending again; anything else gets a fresh id.
 */
export function beginAttempt(key: string, newId: () => string = () => crypto.randomUUID()) {
  const current = readDraft(key);
  if (current.attempt?.state === 'sending') return null;
  const open = current.attempt && isOpen(current.attempt.state) ? current.attempt : null;
  const attempt: Attempt = {
    requestId: open?.requestId ?? newId(),
    text: open?.text ?? current.text.trim(),
    state: 'sending',
  };
  write(key, { ...current, attempt });
  return attempt;
}
/**
 * Records an attempt's outcome, only if it is still this draft's attempt. A confirmed send
 * clears the text only when it is still the text that was sent.
 */
export function settleAttempt(
  key: string,
  requestId: string,
  state: AttemptState | 'sent',
  code?: string,
) {
  const current = readDraft(key);
  if (current.attempt?.requestId !== requestId) return;
  if (state === 'sent') {
    const untouched = current.text.trim() === current.attempt.text;
    write(key, { text: untouched ? '' : current.text, attempt: null, sentAt: Date.now() });
    return;
  }
  write(key, { ...current, attempt: { ...current.attempt, state, ...(code ? { code } : {}) } });
}
export function clearAll() {
  drafts.clear();
  listeners.forEach((l) => l());
}

export function useDraft(key: string): Draft {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => readDraft(key),
  );
}
