import type { WorkspaceId } from '@agent-sales/shared';
import type { ChannelFacade } from '../../channel/api/index.js';
import type { ConversationStore } from './ports/conversation-store.js';

const RETRY_AFTER_MS = 24 * 3600 * 1000;

/**
 * Asks Meta for the customer's name and picture. The attempt is stamped before the call result is
 * known, so a failing profile costs one Meta request a day, not one per message. Meta picture URLs
 * expire, which is why a successful profile is refreshed daily too.
 */
export async function refreshCustomerProfile(
  store: ConversationStore,
  channels: ChannelFacade,
  ws: WorkspaceId,
  id: string,
): Promise<void> {
  try {
    await lookup(store, channels, ws, id);
  } catch {
    // A nicety: a failed lookup never fails message processing. Nothing is logged here because
    // the error text could carry the customer's id.
  }
}

async function lookup(
  store: ConversationStore,
  channels: ChannelFacade,
  ws: WorkspaceId,
  id: string,
): Promise<void> {
  // Claim the attempt first (short transaction), then call Meta outside any transaction.
  const target = await store.run(ws, async (tx) => {
    const c = await tx.find(id);
    if (!c) return null;
    if (c.profileFetchedAt && Date.now() - Date.parse(c.profileFetchedAt) < RETRY_AFTER_MS)
      return null;
    await tx.save({ ...c, profileFetchedAt: new Date().toISOString() });
    return { channelId: c.channelId, customerId: c.customerId };
  });
  if (!target) return;
  const profile = await channels.fetchCustomerProfile(ws, target.channelId, target.customerId);
  if (!profile || (!profile.name && !profile.avatarUrl)) return;
  await store.run(ws, async (tx) => {
    // Re-read: the customer may have written (or staff acted) while Meta was answering.
    const c = await tx.find(id);
    if (!c) return;
    await tx.save({
      ...c,
      customerName: profile.name ?? c.customerName,
      customerAvatarUrl: profile.avatarUrl ?? c.customerAvatarUrl,
    });
  });
}
