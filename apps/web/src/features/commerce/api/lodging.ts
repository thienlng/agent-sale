import {
  type CreateStayRequest,
  ProductListResponse,
  StayQuote,
  StayRequestDto,
  StayRequestList,
  type StayQuoteRequest,
  type UpdateStayStatusRequest,
} from '@agent-sales/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useWorkspaceId } from '@/lib/use-workspace';

export function useAccommodations() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: ['ws', ws, 'accommodations'],
    queryFn: async ({ signal }) => {
      const result = await api('/products?status=active&pageSize=100', ProductListResponse, {
        workspaceId: ws,
        signal,
      });
      return result.data.filter((p) => p.accommodation);
    },
    enabled: Boolean(ws),
  });
}

export function useStays(offset = 0) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: ['ws', ws, 'stay-requests', offset],
    queryFn: () => api(`/stay-requests?offset=${offset}`, StayRequestList, { workspaceId: ws }),
    enabled: Boolean(ws),
  });
}
export function useCreateStay() {
  const ws = useWorkspaceId(),
    qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateStayRequest) =>
      api('/stay-requests', StayRequestDto, { method: 'POST', body, workspaceId: ws }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ws', ws, 'stay-requests'] }),
  });
}
export function useStayQuote() {
  const ws = useWorkspaceId();
  return useMutation({
    mutationFn: (body: StayQuoteRequest) =>
      api('/stay-requests/quote', StayQuote, { method: 'POST', body, workspaceId: ws }),
  });
}
export function useUpdateStayStatus() {
  const ws = useWorkspaceId(),
    qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateStayStatusRequest }) =>
      api(`/stay-requests/${id}/status`, StayRequestDto, {
        method: 'PATCH',
        body,
        workspaceId: ws,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ws', ws, 'stay-requests'] }),
  });
}
