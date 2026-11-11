import { onPrivateStateCleared } from '@/lib/private-browser-state';

/**
 * Reply drafts made on Today, waiting for the inbox composer of their conversation. In memory
 * only: customer conversation text never goes into the URL, the history or storage, and logout
 * clears it. Keyed by business and conversation; a newer draft replaces an older one.
 */
const drafts = new Map<string, string>();
const key = (workspaceId: string, conversationId: string) => `${workspaceId}:${conversationId}`;

export function putPendingDraft(workspaceId: string, conversationId: string, text: string): void {
  drafts.set(key(workspaceId, conversationId), text);
}

/** The waiting draft, left in place (the composer may refuse it). */
export function peekPendingDraft(workspaceId: string, conversationId: string): string | undefined {
  return drafts.get(key(workspaceId, conversationId));
}

/** Drops the draft once the composer holds it; only when it is still `text` (not a newer one). */
export function takePendingDraft(workspaceId: string, conversationId: string, text: string): void {
  if (drafts.get(key(workspaceId, conversationId)) === text)
    drafts.delete(key(workspaceId, conversationId));
}

onPrivateStateCleared(() => drafts.clear());
