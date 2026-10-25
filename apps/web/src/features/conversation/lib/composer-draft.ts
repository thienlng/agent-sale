import type { SendInboxMessageRequest } from '@agent-sales/contracts';

export type DraftAttachment = NonNullable<SendInboxMessageRequest['attachment']>;
export interface ComposerDraft {
  text: string;
  attachment: DraftAttachment | null;
  attempt: SendInboxMessageRequest | null;
  failedAttempt?: boolean;
  attachmentAttempt?: SendInboxMessageRequest | null;
  attachmentFailedAttempt?: boolean;
  noteBase?: { note: string; revision: number };
}

// Drafts stay in this tab's memory only, never in persistent browser storage.
const drafts = new Map<string, ComposerDraft>();
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

export function draftKey(userId: string, workspaceId: string, conversationId: string): string {
  return JSON.stringify([userId, workspaceId, conversationId]);
}

export function readDraft(key: string): ComposerDraft {
  return drafts.get(key) ?? empty;
}

export function writeDraft(key: string, draft: ComposerDraft): void {
  if (!draft.text && !draft.attachment && !draft.attempt) drafts.delete(key);
  else drafts.set(key, draft);
  listeners.get(key)?.forEach((listener) => listener());
}

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
