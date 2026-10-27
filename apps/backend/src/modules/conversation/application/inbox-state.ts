import type { ConversationView } from '@agent-sales/contracts';
import { newId, userId, type WorkspaceId } from '@agent-sales/shared';
import type { IdentityFacade } from '../../identity/api/index.js';
import type { TeamFacade } from '../../team/api/index.js';
import { ConversationError } from '../domain/conversation.errors.js';
import { withNote } from '../domain/conversation-state.js';
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
  const at = new Date().toISOString();
  return load(store, ws, id, (c) => ({
    ...c,
    unreadCount: 0,
    lastReadAt: at,
    lastReadBy: { userId: actorId, name },
    // The "new lead" flag goes away the first time staff open the conversation.
    ...(c.lead && !c.lead.seenAt ? { lead: { ...c.lead, seenAt: at } } : {}),
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
  return load(store, ws, id, (c) =>
    withNote(c, {
      id: newId(),
      authorId: actorId,
      authorName,
      text: body,
      createdAt: new Date().toISOString(),
    }),
  );
}

/** Only an active member of the workspace can be given a conversation. */
export async function assertAssignable(
  team: TeamFacade,
  ws: WorkspaceId,
  memberId: string,
  actorId: string,
): Promise<void> {
  const members = await team.listMembers(ws, { userId: actorId, role: undefined });
  if (!members.some((m) => m.userId === memberId && m.status === 'active'))
    throw new ConversationError(
      'VALIDATION_FAILED',
      'Assignee must be an active member of this workspace',
    );
}
