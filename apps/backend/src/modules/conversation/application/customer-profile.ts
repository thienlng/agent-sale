import type { WorkspaceId } from '@agent-sales/shared';
import type { ChannelFacade } from '../../channel/api/index.js';
import type { ConversationStore } from './ports/conversation-store.js';

const RETRY_AFTER_MS = 24 * 3600 * 1000;
/** A failed lookup (network, 5xx, timeout, refusal) is retried sooner than a success. */
const RETRY_AFTER_FAILURE_MS = 15 * 60 * 1000;

/**
 * Asks Meta for the customer's name and picture. The attempt is stamped before the call, so concurrent
 * messages share one request; a failure is retried after 15 minutes, a success after a day. Meta picture URLs
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
  const profile = await channels
    .fetchCustomerProfile(ws, target.channelId, target.customerId)
    .catch(() => null);
  if (!profile) {
    // Backdate the stamp so the next message retries after 15 minutes, not a day.
    const stamp = new Date(Date.now() - RETRY_AFTER_MS + RETRY_AFTER_FAILURE_MS).toISOString();
    await store.run(ws, async (tx) => {
      const c = await tx.find(id);
      if (c) await tx.save({ ...c, profileFetchedAt: stamp });
    });
    return;
  }
  if (!profile.name && !profile.avatarUrl) return;
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
