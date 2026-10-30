import { MessageUsageDto } from '@agent-sales/contracts';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api-client';
import { useWorkspaceId } from '@/lib/use-workspace';

export const billingKeys = {
  usage: (workspaceId: string) => ['ws', workspaceId, 'billing', 'usage'] as const,
};

/** The account's AI-message allowance for this cycle, shared by all its businesses (T-091). */
export function useMessageUsage() {
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: billingKeys.usage(workspaceId),
    queryFn: () => api('/billing/usage', MessageUsageDto),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}
