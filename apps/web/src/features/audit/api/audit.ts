import { AuditList } from '@agent-sales/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';

import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { withQuery } from '@/lib/url';
import { useWorkspaceId } from '@/lib/use-workspace';

/** The change log, newest first, loaded page by page with the server's keyset cursor. */
export function useAuditEvents(action: string | undefined) {
  const ws = useWorkspaceId();
  return useInfiniteQuery({
    queryKey: [...queryKeys.audit(ws), action ?? 'all'],
    initialPageParam: undefined as { before: string; beforeId: string } | undefined,
    queryFn: ({ pageParam }) =>
      api(withQuery('/audit-events', { action, limit: 30, ...(pageParam ?? {}) }), AuditList),
    getNextPageParam: (last) => last.next ?? undefined,
    enabled: Boolean(ws),
  });
}
