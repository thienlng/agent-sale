import { type CreateWorkspaceRequest, WorkspaceDto } from '@agent-sales/contracts';
import { useMutation } from '@tanstack/react-query';

import { api } from '@/lib/api-client';
import { reloadSession } from '@/lib/session';

/**
 * Creates a business for the signed-in account (the request is not scoped to one
 * business) and refreshes the memberships so the new one can be opened.
 */
export function useCreateBusiness() {
  return useMutation({
    mutationFn: async (body: CreateWorkspaceRequest) => {
      const created = await api('/workspaces', WorkspaceDto, {
        method: 'POST',
        body,
        workspaceScoped: false,
      });
      await reloadSession();
      return created;
    },
  });
}
