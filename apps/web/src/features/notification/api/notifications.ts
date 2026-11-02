import { NotificationCount, NotificationDto, NotificationList } from '@agent-sales/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api-client';
import { useWorkspaceId } from '@/lib/use-workspace';

/**
 * Notifications belong to the user in the account (not to one business), but the routes are
 * resolved through the current business header, so the keys carry it.
 */
export const notificationKeys = {
  all: (ws: string) => ['ws', ws, 'notifications'] as const,
  unread: (ws: string) => ['ws', ws, 'notifications', 'unread'] as const,
  list: (ws: string) => ['ws', ws, 'notifications', 'list'] as const,
};

/** Unread count polling interval (spec §11: one cheap indexed count a minute per open tab). */
export const UNREAD_REFETCH_MS = 60_000;
export const NOTIFICATION_PAGE = 20;

/** The bell's badge: refetched every minute and when the window regains focus. */
export function useUnreadCount({ enabled = true }: { enabled?: boolean } = {}) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: notificationKeys.unread(ws),
    queryFn: ({ signal }) =>
      api('/notifications/unread-count', NotificationCount, { workspaceId: ws, signal }).then(
        (r) => r.count,
      ),
    enabled: enabled && Boolean(ws),
    refetchInterval: UNREAD_REFETCH_MS,
    refetchOnWindowFocus: true,
  });
}

/** Newest first, 20 per page; "Xem thêm" loads the next keyset page. */
export function useNotifications({ enabled = true }: { enabled?: boolean } = {}) {
  const ws = useWorkspaceId();
  return useInfiniteQuery({
    queryKey: notificationKeys.list(ws),
    initialPageParam: null as NotificationList['next'],
    queryFn: ({ pageParam, signal }) => {
      const q = new URLSearchParams({ limit: String(NOTIFICATION_PAGE) });
      if (pageParam) {
        q.set('before', pageParam.before);
        q.set('beforeId', pageParam.beforeId);
      }
      return api(`/notifications?${q.toString()}`, NotificationList, { workspaceId: ws, signal });
    },
    getNextPageParam: (last) => last.next,
    enabled: enabled && Boolean(ws),
  });
}

export function useMarkRead() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/notifications/${id}/read`, NotificationDto, {
        method: 'POST',
        body: {},
        workspaceId: ws,
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: notificationKeys.all(ws) }),
  });
}

export function useMarkAllRead() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api('/notifications/read-all', NotificationCount, {
        method: 'POST',
        body: {},
        workspaceId: ws,
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: notificationKeys.all(ws) }),
  });
}
