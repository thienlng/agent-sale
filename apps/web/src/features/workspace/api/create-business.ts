import { type CreateWorkspaceRequest, WorkspaceDto } from '@agent-sales/contracts';
import { useMutation } from '@tanstack/react-query';

import { api } from '@/lib/api-client';

/**
 * Creates a business under the caller's only owned account (the server resolves `accountId`).
 * Not workspace-scoped: the new business does not exist yet.
 */
export function useCreateBusiness() {
  return useMutation({
    mutationFn: (body: CreateWorkspaceRequest) =>
      api('/workspaces', WorkspaceDto, { method: 'POST', body, workspaceScoped: false }),
  });
}
