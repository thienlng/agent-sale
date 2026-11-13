import { LinkedIdentityList } from '@agent-sales/contracts';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

const account = { workspaceScoped: false } as const;

/** Sign-ins linked to the account (Google). */
export function useLinkedIdentities() {
  return useQuery({
    queryKey: queryKeys.linkedIdentities,
    queryFn: async () => (await api('/auth/identities', LinkedIdentityList, account)).data,
  });
}

/** Removes a linked sign-in; the API client asks the user to confirm it is them first if needed. */
export function useUnlinkIdentity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ provider, subject }: { provider: string; subject: string }) =>
      api(
        `/auth/identities/${encodeURIComponent(provider)}/${encodeURIComponent(subject)}`,
        z.null(),
        { ...account, method: 'DELETE' },
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.linkedIdentities }),
  });
}
