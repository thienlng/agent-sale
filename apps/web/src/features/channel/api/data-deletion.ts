import { MetaDataDeletionStatus } from '@agent-sales/contracts';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api-client';

/** Public: the status of a Meta data deletion request, by its confirmation code (no sign-in). */
export function useDataDeletionStatus(code: string | undefined) {
  return useQuery({
    queryKey: ['public', 'meta-data-deletion', code ?? ''],
    queryFn: () =>
      api(`/meta/data-deletion/${encodeURIComponent(code ?? '')}`, MetaDataDeletionStatus, {
        workspaceScoped: false,
      }),
    enabled: Boolean(code),
    retry: false,
  });
}
