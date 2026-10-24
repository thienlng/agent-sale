import {
  ChannelListResponse,
  ConversationDetailDto,
  ConversationDto,
  ConversationListResponse,
  InboxMessageDto,
  TrainingItemList,
  type ConversationListQuery,
  type SendInboxMessageRequest,
  type UpdateConversationRequest,
} from '@agent-sales/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useWorkspaceId } from '@/lib/use-workspace';
import { withQuery } from '@/lib/url';
export function useInbox(query: ConversationListQuery) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: ['inbox', ws, query],
    queryFn: () => api(withQuery('/conversations', query), ConversationListResponse),
    enabled: Boolean(ws),
    refetchInterval: 5000,
  });
}
export function useInboxChannels() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: ['channels', ws],
    queryFn: () => api('/channels', ChannelListResponse),
    enabled: Boolean(ws),
  });
}
export function useConversation(id: string | null) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: ['conversation', ws, id],
    queryFn: () => api(`/conversations/${id}`, ConversationDetailDto),
    enabled: Boolean(ws && id),
    refetchInterval: 3000,
  });
}
export function useQuickReplies(botId: string | null) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: ['inbox-quick-replies', ws, botId],
    queryFn: async () =>
      (await api(`/bots/${botId}/training-items`, TrainingItemList)).data.filter(
        (item) => item.kind === 'quick_reply',
      ),
    enabled: Boolean(ws && botId),
  });
}
export function useInboxActions(id: string | null) {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['inbox', ws] }),
      qc.invalidateQueries({ queryKey: ['conversation', ws, id] }),
    ]);
  const update = useMutation({
    mutationFn: (body: UpdateConversationRequest) =>
      api(`/conversations/${id}`, ConversationDto, { method: 'PATCH', body }),
    onSuccess: refresh,
  });
  const send = useMutation({
    mutationFn: (body: SendInboxMessageRequest) =>
      api(`/conversations/${id}/messages`, InboxMessageDto, { method: 'POST', body }),
    onSuccess: refresh,
  });
  return { update, send };
}
