import { useEffect, useRef, useState } from 'react';
import { useReadState } from '../api/inbox';
import type { InboxConversation } from '../lib/inbox-v2-types';

/** Conversations the user explicitly marked unread; read-on-open must not undo that. */
const explicitUnread = new Set<string>();

/** Marks unread through the same guard whether it comes from the pane, a shortcut or the list row. */
export async function markUnreadGuarded(
  id: string,
  mutate: (id: string) => Promise<unknown>,
): Promise<void> {
  explicitUnread.add(id);
  try {
    await mutate(id);
  } catch (error) {
    explicitUnread.delete(id);
    throw error;
  }
}

function useVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

/**
 * Opening a conversation marks it read for the whole shop, but only while the tab is visible
 * (it happens when the tab comes back). It re-marks only when more customer messages arrive
 * while open, never right after an explicit "mark unread".
 * Returns the explicit mark-unread action.
 */
export function useReadOnOpen(
  id: string,
  conversation: Pick<InboxConversation, 'unreadCount' | 'lastReadAt'> | undefined,
): { markUnread: () => Promise<void>; pending: boolean } {
  const { markRead, markUnread } = useReadState();
  // Highest unread count already handled for this open; -1 until the first look.
  const handled = useRef(-1);
  const visible = useVisible();
  const unreadCount = conversation?.unreadCount;
  const lastReadAt = conversation?.lastReadAt ?? null;
  const loaded = conversation !== undefined;
  const mark = markRead.mutate;
  useEffect(() => {
    if (!loaded || unreadCount === undefined || !visible) return;
    if (explicitUnread.has(id)) {
      // Wait until the explicit unread shows up, then treat it as handled.
      if (unreadCount > 0) {
        handled.current = unreadCount;
        explicitUnread.delete(id);
      }
      return;
    }
    if (unreadCount === 0 && lastReadAt !== null) {
      handled.current = 0;
      return;
    }
    if (unreadCount > handled.current || (handled.current === -1 && lastReadAt === null)) {
      handled.current = Math.max(unreadCount, 0);
      // Best effort: an older API has no read route, and the list still works.
      mark(id);
    }
  }, [id, loaded, unreadCount, lastReadAt, mark, visible]);
  return {
    markUnread: () => markUnreadGuarded(id, markUnread.mutateAsync),
    pending: markUnread.isPending,
  };
}
