import { EntitlementsDto } from '@agent-sales/contracts';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api-client';
import { useWorkspaceId } from '@/lib/use-workspace';

/** What the current plan allows (limits, features, included AI messages). */
export function useEntitlements({ enabled = true }: { enabled?: boolean } = {}) {
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: ['ws', workspaceId, 'billing', 'entitlements'] as const,
    queryFn: () => api('/billing/entitlements', EntitlementsDto),
    enabled: enabled && Boolean(workspaceId),
    staleTime: 60_000,
  });
}
