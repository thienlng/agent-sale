import {
  ConversationDto,
  InboxMessageDto,
  type UpdateConversationRequest,
} from '@agent-sales/contracts';
import { z } from 'zod';

/**
 * Inbox v2 (T-073) DTO extensions. The backend adds these fields in parallel; they live here
 * until `packages/contracts` carries them. Every new field has a fallback so the client also
 * works against the previous API.
 */
export const InboxTagChip = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().default('#f26b1d'),
  /** The tag assignment on the conversation; needed to remove it. */
  assignmentId: z.string().optional(),
});
export type InboxTagChip = z.infer<typeof InboxTagChip>;

export const InboxNote = z.object({
  id: z.string(),
  authorId: z.string().nullable().default(null),
  authorName: z.string().nullable().default(null),
  text: z.string(),
  createdAt: z.string(),
});
export type InboxNote = z.infer<typeof InboxNote>;

export const InboxConversationDto = ConversationDto.extend({
  customerAvatarUrl: z.string().nullable().default(null),
  unreadCount: z.number().int().default(0),
  lastReadAt: z.string().nullable().default(null),
  lastReadBy: z
    .object({ userId: z.string(), name: z.string().nullable().default(null) })
    .nullable()
    .default(null),
  awaitingSince: z.string().nullable().default(null),
  lastMessageSender: z.enum(['customer', 'human', 'bot']).default('customer'),
  customerPhone: z.string().nullable().default(null),
  notes: z.array(InboxNote).default([]),
  tags: z.array(InboxTagChip).default([]),
  createdAt: z.string().optional(),
});
export type InboxConversation = z.infer<typeof InboxConversationDto>;

export const InboxCounts = z.object({
  all: z.number().int().default(0),
  unread: z.number().int().default(0),
  waiting: z.number().int().default(0),
});
export type InboxCounts = z.infer<typeof InboxCounts>;

export const InboxListResponse = z.object({
  data: z.array(InboxConversationDto),
  /** Absent on the previous API; the list then derives counts from the loaded page. */
  counts: InboxCounts.optional(),
});
export type InboxListResponse = z.infer<typeof InboxListResponse>;

export const InboxDetailResponse = z.object({
  conversation: InboxConversationDto,
  messages: z.array(InboxMessageDto),
});
export type InboxDetailResponse = z.infer<typeof InboxDetailResponse>;

export type InboxTab = 'all' | 'unread' | 'waiting';
export type WaitingFilter = 'any' | 'longest' | 'readNotReplied';

/** Query accepted by GET /conversations in inbox v2. */
export interface InboxListQuery {
  tab?: InboxTab;
  assignee?: string;
  channelId?: string;
  provider?: 'facebook' | 'instagram';
  hasPhone?: boolean;
  waiting?: WaitingFilter;
  status?: 'open' | 'resolved';
  mode?: 'bot' | 'human';
  q?: string;
  sort?: 'recent' | 'waitingLongest';
  tagsAny?: string;
  tagsAll?: string;
  tagsExclude?: string;
  untagged?: boolean;
  limit?: number;
}

/** PATCH /conversations/{id}: the current request plus the assignee (uuid or null). */
export type InboxUpdateBody = UpdateConversationRequest & {
  assigneeId?: string | null | undefined;
};
