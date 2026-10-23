import { WorkspaceDto } from '@agent-sales/contracts';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api-client';

export const workspaceKeys = {
  current: (workspaceId: string) => ['workspace', 'current', workspaceId] as const,
};

/** Feature hook: data access for the workspace feature lives in features/<module>/api. */
export function useCurrentWorkspace(workspaceId: string) {
  return useQuery({
    queryKey: workspaceKeys.current(workspaceId),
    queryFn: () => api('/workspaces/current', WorkspaceDto, { workspaceId }),
    enabled: Boolean(workspaceId),
  });
}
