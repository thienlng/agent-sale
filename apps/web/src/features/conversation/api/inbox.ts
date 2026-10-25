import {
  BotDto,
  ChannelListResponse,
  InboxMessageDto,
  MemberList,
  TagAssignmentDto,
  TagList,
  TrainingItemList,
  type SendInboxMessageRequest,
} from '@agent-sales/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useWorkspaceId } from '@/lib/use-workspace';
import { withQuery } from '@/lib/url';
import {
  InboxConversationDto,
  InboxDetailResponse,
  InboxListResponse,
  InboxNote,
  type InboxListQuery,
  type InboxUpdateBody,
} from '../lib/inbox-v2-types';

// Inbox v2 (T-073): the request/response shapes below are local until packages/contracts
// carries them (see lib/inbox-v2-types.ts). Switch to the contracts schemas then.

export function useInbox(query: InboxListQuery) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: ['inbox', ws, query],
    queryFn: () => api(withQuery('/conversations', query), InboxListResponse),
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
    queryFn: () => api(`/conversations/${id}`, InboxDetailResponse),
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
/** The bot's image library (training media with an HTTPS URL), offered as attachments. */
export function useMediaLibrary(botId: string | null) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: ['inbox-media', ws, botId],
    queryFn: async () =>
      (await api(`/bots/${botId}/training-items`, TrainingItemList)).data.filter(
        (item): item is typeof item & { mediaUrl: string } =>
          item.kind === 'media' && Boolean(item.mediaUrl),
      ),
    enabled: Boolean(ws && botId),
  });
}

/** The bot that answers a channel: whether it is active and how long a takeover lasts. */
export function useInboxBot(botId: string | null) {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [...queryKeys.bot(ws, botId ?? ''), 'inbox'],
    queryFn: async () => {
      const bot = await api(`/bots/${botId}`, BotDto);
      return { isActive: bot.isActive, takeoverMinutes: bot.settings.humanTakeoverMinutes };
    },
    enabled: Boolean(ws && botId),
    staleTime: 60000,
  });
}

/** Workspace members for the assignee picker and the assignee filter. */
export function useInboxMembers() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [...queryKeys.members(ws), 'inbox'],
    queryFn: async () =>
      (await api('/members', MemberList)).data.filter((m) => m.status === 'active'),
    enabled: Boolean(ws),
    staleTime: 60000,
  });
}

/** The CRM tag library, shared by the filter popover, tag bar and picker. */
export function useInboxTags() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [...queryKeys.crmTags(ws), 'inbox'],
    queryFn: async () => (await api('/crm/tags', TagList)).data.filter((tag) => !tag.archived),
    enabled: Boolean(ws),
    staleTime: 60000,
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
    mutationFn: (body: InboxUpdateBody) =>
      api(`/conversations/${id}`, InboxConversationDto, { method: 'PATCH', body }),
    onSettled: refresh,
  });
  const send = useMutation({
    mutationFn: (body: SendInboxMessageRequest) =>
      api(`/conversations/${id}/messages`, InboxMessageDto, { method: 'POST', body }),
    onSuccess: refresh,
  });
  return { update, send };
}

const Ack = z.unknown();

/** Shared read state: opening marks read for the whole shop, "unread" brings it back. */
export function useReadState() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const refresh = (id: string) =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['inbox', ws] }),
      qc.invalidateQueries({ queryKey: ['conversation', ws, id] }),
    ]);
  const markRead = useMutation({
    mutationFn: (id: string) => api(`/conversations/${id}/read`, Ack, { method: 'POST', body: {} }),
    onSettled: (_data, _error, id) => refresh(id),
  });
  const markUnread = useMutation({
    mutationFn: (id: string) =>
      api(`/conversations/${id}/unread`, Ack, { method: 'POST', body: {} }),
    onSettled: (_data, _error, id) => refresh(id),
  });
  return { markRead, markUnread };
}

/** Assign a conversation from the list row menu, where no conversation is open. */
export function useAssignConversation() {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; assigneeId: string | null }) =>
      api(`/conversations/${v.id}`, InboxConversationDto, {
        method: 'PATCH',
        body: { assigneeId: v.assigneeId },
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['inbox', ws] }),
  });
}

export function useAddNote(id: string) {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) =>
      api(`/conversations/${id}/notes`, InboxNote, { method: 'POST', body: { text } }),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['conversation', ws, id] }),
        qc.invalidateQueries({ queryKey: ['inbox', ws] }),
      ]),
  });
}

/** Conversation tags: attach through the conversation route, remove through the assignment. */
export function useConversationTagActions(id: string) {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['conversation', ws, id] }),
      qc.invalidateQueries({ queryKey: ['inbox', ws] }),
      qc.invalidateQueries({ queryKey: queryKeys.crmTags(ws) }),
    ]);
  const attach = useMutation({
    mutationFn: (tagId: string) =>
      api(`/conversations/${id}/tags`, TagAssignmentDto, { method: 'POST', body: { tagId } }),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (assignmentId: string) =>
      api(`/tag-assignments/${assignmentId}/remove`, TagAssignmentDto, {
        method: 'POST',
        body: {},
      }),
    onSettled: refresh,
  });
  return { attach, remove };
}
