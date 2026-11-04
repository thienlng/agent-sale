import { CustomerRequestList, RequestSummaryDto } from '@agent-sales/contracts';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useWorkspaceId } from '@/lib/use-workspace';

/*
 * Requests the bot recorded on customers (education and spa; ESV spec §4.4). Keys sit under the
 * contacts key, so a status change or a refreshed customer list reloads them too.
 */

/** Customers per status, the latest open requests and the 7-day count; needs contacts.view_all. */
export function useRequestSummary(enabled: boolean) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [...queryKeys.contacts(ws), 'requests', 'summary'],
    queryFn: ({ signal }) =>
      api('/crm/requests/summary', RequestSummaryDto, { workspaceId: ws, signal }),
    enabled: Boolean(ws) && enabled,
  });
}

/** The customer's latest requests, newest first. */
export function useContactRequests(contactId: string | undefined) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [...queryKeys.contacts(ws), 'requests', 'contact', contactId ?? ''],
    queryFn: ({ signal }) =>
      api(`/contacts/${contactId}/requests`, CustomerRequestList, { workspaceId: ws, signal }),
    enabled: Boolean(ws && contactId),
  });
}
