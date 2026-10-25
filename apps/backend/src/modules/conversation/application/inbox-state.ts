import { MAX_CONVERSATION_NOTES, type ConversationView } from '@agent-sales/contracts';
import { newId, userId, type WorkspaceId } from '@agent-sales/shared';
import type { IdentityFacade } from '../../identity/api/index.js';
import { ConversationError } from '../domain/conversation.errors.js';
import type { ConversationStore } from './ports/conversation-store.js';

// Read state and notes are shop-level annotations, not control changes: none of them bumps
// `revision` (it fences pending bot replies) or `updatedAt` (it orders the list).

async function load(
  store: ConversationStore,
  ws: WorkspaceId,
  id: string,
  change: (c: ConversationView) => ConversationView,
): Promise<ConversationView> {
  return store.run(ws, async (tx) => {
    const c = await tx.find(id);
    if (!c) throw new ConversationError('NOT_FOUND', 'Conversation not found');
    const updated = change(c);
    await tx.save(updated);
    return updated;
  });
}

/** Shared by the whole shop: opening a conversation clears it for everyone and records who. */
export async function markRead(
  store: ConversationStore,
  identity: IdentityFacade,
  ws: WorkspaceId,
  id: string,
  actorId: string,
): Promise<ConversationView> {
  const name = (await identity.displayName(userId(actorId))) ?? '';
  return load(store, ws, id, (c) => ({
    ...c,
    unreadCount: 0,
    lastReadAt: new Date().toISOString(),
    lastReadBy: { userId: actorId, name },
  }));
}

export function markUnread(
  store: ConversationStore,
  ws: WorkspaceId,
  id: string,
): Promise<ConversationView> {
  return load(store, ws, id, (c) => ({
    ...c,
    unreadCount: Math.max(1, c.unreadCount),
    lastReadAt: null,
    lastReadBy: null,
  }));
}

export async function addNote(
  store: ConversationStore,
  identity: IdentityFacade,
  ws: WorkspaceId,
  id: string,
  text: string,
  actorId: string,
): Promise<ConversationView> {
  const body = text.trim();
  if (!body || body.length > 10000)
    throw new ConversationError('VALIDATION_FAILED', 'A note holds 1 to 10000 characters');
  const authorName = (await identity.displayName(userId(actorId))) ?? '';
  return load(store, ws, id, (c) => ({
    ...c,
    // `note` mirrors the newest entry for callers that still read the legacy field.
    note: body,
    notes: [
      ...c.notes,
      {
        id: newId(),
        authorId: actorId,
        authorName,
        text: body,
        createdAt: new Date().toISOString(),
      },
    ].slice(-MAX_CONVERSATION_NOTES),
  }));
}
