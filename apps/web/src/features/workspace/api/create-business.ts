import { type CreateWorkspaceRequest, WorkspaceDto } from '@agent-sales/contracts';
import { useMutation } from '@tanstack/react-query';

import { api } from '@/lib/api-client';

/**
 * Creates a business. The server resolves the account when the caller owns one; owners of
 * several accounts pass `accountId`. Not workspace-scoped: the new business does not exist yet.
 * Callers reload the session themselves, so a failed reload is not mistaken for a failed create.
 */
export function useCreateBusiness() {
  return useMutation({
    mutationFn: (body: CreateWorkspaceRequest) =>
      api('/workspaces', WorkspaceDto, { method: 'POST', body, workspaceScoped: false }),
  });
}
