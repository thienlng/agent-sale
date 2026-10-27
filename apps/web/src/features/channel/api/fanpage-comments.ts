import {
  FanpageAction,
  FanpageCommentDetail,
  FanpageCommentPage,
  FanpageCommentPost,
  FanpageCommentSource,
  FanpagePost,
  type FanpageActionKind,
} from '@agent-sales/contracts';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { z } from 'zod';
import { api } from '@/lib/api-client';
import { withQuery } from '@/lib/url';
import { useWorkspaceId } from '@/lib/use-workspace';

/**
 * Data for the Inbox comment workspace. Separate from `useFanpage` (the settings screen), so
 * opening comments never loads settings or automation, and every read is side-effect free.
 */
const root = (ws: string, page: string) => ['fanpage-comments', ws, page] as const;
const path = (page: string) => `/channels/${page}/fanpage`;
export interface CommentFilter {
  postId: string | null;
  q: string;
}
const PAGE_SIZE = 30;

export function useCommentList(page: string, filter: CommentFilter) {
  const ws = useWorkspaceId();
  return useInfiniteQuery({
    queryKey: [...root(ws, page), 'list', filter.postId, filter.q],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api(
        withQuery(`${path(page)}/comments`, {
          limit: PAGE_SIZE,
          postId: filter.postId ?? undefined,
          q: filter.q || undefined,
          cursor: pageParam,
        }),
        FanpageCommentPage,
        { workspaceId: ws },
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(ws && page),
    // New arrivals appear at the top; loaded older pages are refetched with them.
    refetchInterval: 15000,
  });
}

export function useCommentDetail(page: string, commentId: string | null) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [...root(ws, page), 'detail', commentId],
    queryFn: () =>
      api(`${path(page)}/comments/${encodeURIComponent(commentId ?? '')}`, FanpageCommentDetail, {
        workspaceId: ws,
      }),
    enabled: Boolean(ws && page && commentId),
    refetchInterval: 10000,
  });
}

/** A fresh Facebook read of the post and thread; asked once per comment, never retried blindly. */
export function useCommentSource(page: string, commentId: string | null) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [...root(ws, page), 'source', commentId],
    queryFn: () =>
      api(
        `${path(page)}/comments/${encodeURIComponent(commentId ?? '')}/source`,
        FanpageCommentSource,
        { workspaceId: ws },
      ),
    enabled: Boolean(ws && page && commentId),
    staleTime: 5 * 60000,
    retry: false,
  });
}

export function useCommentPosts(page: string) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [...root(ws, page), 'posts'],
    queryFn: () =>
      api(`${path(page)}/comment-posts`, z.object({ data: z.array(FanpageCommentPost) }), {
        workspaceId: ws,
      }),
    enabled: Boolean(ws && page),
    staleTime: 60000,
  });
}

/** Facebook's latest posts, only to label known posts; failure never hides stored ones. */
export function useLatestPosts(page: string) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [...root(ws, page), 'latest-posts'],
    queryFn: () =>
      api(`${path(page)}/posts`, z.object({ data: z.array(FanpagePost) }), { workspaceId: ws }),
    enabled: Boolean(ws && page),
    staleTime: 5 * 60000,
    retry: false,
  });
}

export interface ActionRequest {
  workspaceId: string;
  page: string;
  commentId: string;
  kind: FanpageActionKind;
  text: string;
  requestId: string;
  version: string;
  confirmPublicContact?: boolean;
}
/**
 * Sends one staff action. The workspace and Page are the ones the action was started in, not
 * whatever is selected when the answer arrives; afterwards only that Page's data refreshes.
 */
export function useCommentActions() {
  const qc = useQueryClient();
  const send = useCallback(
    async (r: ActionRequest) => {
      try {
        return await api(
          `${path(r.page)}/comments/${encodeURIComponent(r.commentId)}/actions`,
          z.object({ action: FanpageAction.nullable() }),
          {
            method: 'POST',
            workspaceId: r.workspaceId,
            body: {
              kind: r.kind,
              text: r.text,
              requestId: r.requestId,
              version: r.version,
              confirmPublicContact: r.confirmPublicContact ?? false,
            },
          },
        );
      } finally {
        void qc.invalidateQueries({ queryKey: root(r.workspaceId, r.page) });
      }
    },
    [qc],
  );
  /** The stored record after an answer that did not include an action. */
  const reload = useCallback(
    (workspaceId: string, page: string, commentId: string) =>
      qc.fetchQuery({
        queryKey: [...root(workspaceId, page), 'detail', commentId],
        queryFn: () =>
          api(`${path(page)}/comments/${encodeURIComponent(commentId)}`, FanpageCommentDetail, {
            workspaceId,
          }),
      }),
    [qc],
  );
  return { send, reload };
}
