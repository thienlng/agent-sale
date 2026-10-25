import { useEffect, useRef } from 'react';
import { useReadState } from '../api/inbox';
import type { InboxConversation } from '../lib/inbox-v2-types';

/**
 * Opening a conversation marks it read for the whole shop. It re-marks only when more customer
 * messages arrive while it stays open, never right after an explicit "mark unread".
 * Returns the explicit mark-unread action.
 */
export function useReadOnOpen(
  id: string,
  conversation: Pick<InboxConversation, 'unreadCount' | 'lastReadAt'> | undefined,
): { markUnread: () => Promise<void>; pending: boolean } {
  const { markRead, markUnread } = useReadState();
  // Highest unread count already handled for this open; -1 until the first look.
  const handled = useRef(-1);
  const unreadCount = conversation?.unreadCount;
  const lastReadAt = conversation?.lastReadAt ?? null;
  const loaded = conversation !== undefined;
  const mark = markRead.mutate;
  useEffect(() => {
    if (!loaded || unreadCount === undefined) return;
    if (unreadCount === 0 && lastReadAt !== null) {
      handled.current = 0;
      return;
    }
    if (unreadCount > handled.current || (handled.current === -1 && lastReadAt === null)) {
      handled.current = Math.max(unreadCount, 0);
      // Best effort: an older API has no read route, and the list still works.
      mark(id);
    }
  }, [id, loaded, unreadCount, lastReadAt, mark]);
  return {
    markUnread: async () => {
      handled.current = 1;
      await markUnread.mutateAsync(id);
    },
    pending: markUnread.isPending,
  };
}
