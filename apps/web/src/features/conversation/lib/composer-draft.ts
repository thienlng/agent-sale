import type { SendInboxMessageRequest } from '@agent-sales/contracts';
import {
  isPrivateStateCurrent,
  onPrivateStateCleared,
  privateStateVersion,
} from '@/lib/private-browser-state';
import {
  DRAFT_STORAGE_PREFIX,
  draftRevisionMatches,
  persistTextDraft,
  restoreTextDraft,
} from './composer-persistence';

export type DraftAttachment = NonNullable<SendInboxMessageRequest['attachment']>;
export interface ComposerDraft {
  text: string;
  attachment: DraftAttachment | null;
  attempt: SendInboxMessageRequest | null;
  failedAttempt?: boolean;
  conflict?: boolean;
  attachmentAttempt?: SendInboxMessageRequest | null;
  attachmentFailedAttempt?: boolean;
}

// Full drafts stay in memory; only DM text and safe text-retry metadata persist.
const drafts = new Map<string, ComposerDraft>();
const unavailable = new Set<string>();
const revisions = new Map<string, string | null | undefined>();
const edited = new Set<string>();
const requestKeys = new Map<string, string>();
const empty: ComposerDraft = { text: '', attachment: null, attempt: null };
const listeners = new Map<string, Set<() => void>>();

export function subscribeDraft(key: string, listener: () => void): () => void {
  const group = listeners.get(key) ?? new Set<() => void>();
  group.add(listener);
  listeners.set(key, group);
  return () => {
    group.delete(listener);
    if (!group.size) listeners.delete(key);
  };
}

export function draftKey(
  userId: string,
  workspaceId: string,
  conversationId: string,
  channelId = '',
): string {
  return JSON.stringify([userId, workspaceId, conversationId, channelId]);
}

export function draftStorageUnavailable(key: string): boolean {
  return unavailable.has(key);
}

onPrivateStateCleared((notify) => {
  drafts.clear();
  unavailable.clear();
  revisions.clear();
  edited.clear();
  requestKeys.clear();
  if (notify) listeners.forEach((group) => group.forEach((listener) => listener()));
});

export function readDraft(key: string): ComposerDraft {
  const cached = drafts.get(key);
  if (cached) return cached;
  const restored = restoreTextDraft(key);
  if (restored.unavailable) unavailable.add(key);
  revisions.set(key, restored.revision);
  if (restored.requestKey) requestKeys.set(key, restored.requestKey);
  const draft = restored.draft ? { ...restored.draft, attachment: null } : empty;
  drafts.set(key, draft);
  return draft;
}

function notify(key: string): void {
  listeners.get(key)?.forEach((listener) => listener());
}

export function writeDraft(
  key: string,
  draft: ComposerDraft,
  version = privateStateVersion(),
): void {
  if (!isPrivateStateCurrent(version)) return;
  const previous = readDraft(key);
  const requestKey =
    draft.attempt?.idempotencyKey ??
    (previous.text === draft.text ? requestKeys.get(key) : undefined) ??
    crypto.randomUUID();
  requestKeys.set(key, requestKey);
  const result = draft.conflict
    ? { status: 'conflict' as const }
    : persistTextDraft(key, draft, revisions.get(key), requestKey);
  if (result.status === 'saved') {
    revisions.set(key, result.revision);
    unavailable.delete(key);
  }
  if (result.status === 'unavailable') unavailable.add(key);
  const next = result.status === 'conflict' ? { ...draft, conflict: true } : draft;
  edited.add(key);
  drafts.set(key, next.text || next.attachment || next.attempt || next.conflict ? next : empty);
  notify(key);
}

/** A shared draft already has a send identity before either tab can submit it. */
export function draftRequestKey(key: string): string {
  readDraft(key);
  const requestKey = requestKeys.get(key) ?? crypto.randomUUID();
  requestKeys.set(key, requestKey);
  return requestKey;
}

export function canSendDraft(key: string, version: number): boolean {
  if (!isPrivateStateCurrent(version)) return false;
  const current = readDraft(key);
  if (current.conflict) return false;
  if (draftRevisionMatches(key, revisions.get(key))) return true;
  drafts.set(key, { ...current, conflict: true });
  notify(key);
  return false;
}

export function resolveDraftConflict(key: string, keepMine: boolean, version: number): void {
  if (!isPrivateStateCurrent(version)) return;
  const current = readDraft(key);
  const remote = restoreTextDraft(key);
  revisions.set(key, remote.revision);
  if (remote.requestKey) requestKeys.set(key, remote.requestKey);
  if (keepMine) {
    // Retain a retry key only when the latest persisted attempt is that same attempt.
    const attempt =
      remote.draft?.attempt?.idempotencyKey === current.attempt?.idempotencyKey
        ? current.attempt
        : null;
    if (!attempt) requestKeys.set(key, crypto.randomUUID());
    writeDraft(
      key,
      {
        ...current,
        attempt,
        conflict: false,
        failedAttempt: attempt ? (current.failedAttempt ?? false) : false,
      },
      version,
    );
  } else {
    drafts.set(key, remote.draft ? { ...remote.draft, attachment: null } : empty);
    edited.delete(key);
    notify(key);
  }
}

window.addEventListener('storage', (event) => {
  if (!event.key?.startsWith(DRAFT_STORAGE_PREFIX)) return;
  const key = event.key.slice(DRAFT_STORAGE_PREFIX.length);
  const current = drafts.get(key);
  if (!current || draftRevisionMatches(key, revisions.get(key))) return;
  if (
    edited.has(key) &&
    (current.text || current.attempt || current.attachment || current.attachmentAttempt)
  )
    drafts.set(key, { ...current, conflict: true });
  else {
    const remote = restoreTextDraft(key);
    revisions.set(key, remote.revision);
    if (remote.requestKey) requestKeys.set(key, remote.requestKey);
    drafts.set(key, { ...current, ...empty, ...remote.draft });
  }
  notify(key);
});

export function insertQuickReply(
  text: string,
  content: string,
  start: number,
  end: number,
): { text: string; cursor: number } | null {
  const next = text.slice(0, start) + content + text.slice(end);
  if (next.length > 2000) return null;
  return { text: next, cursor: start + content.length };
}

/** Quick replies matching "/query" typed at the start of the draft; null when the menu is closed. */
export function slashQuery(draft: string): string | null {
  const match = /^\/(\S*)$/.exec(draft);
  return match ? (match[1] ?? '') : null;
}

export function filterSlashReplies<T extends { title: string; content: string }>(
  items: readonly T[],
  query: string,
): T[] {
  const needle = query.toLocaleLowerCase();
  return items.filter(
    (item) =>
      item.title.toLocaleLowerCase().includes(needle) ||
      item.content.toLocaleLowerCase().includes(needle),
  );
}
