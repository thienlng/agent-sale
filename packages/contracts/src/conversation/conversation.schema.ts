import { z } from 'zod';
import { MetaProvider } from '../channel/channel.schema.js';
export const ConversationDto = z.object({
  id: z.uuid(),
  channelId: z.uuid(),
  provider: MetaProvider,
  customerId: z.string(),
  customerName: z.string(),
  mode: z.enum(['human', 'bot']),
  autoResumeAt: z.iso.datetime().nullable().default(null),
  status: z.enum(['open', 'resolved']),
  assigneeId: z.uuid().nullable(),
  note: z.string(),
  revision: z.number().int(),
  lastMessage: z.string(),
  lastInboundAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ConversationDto = z.infer<typeof ConversationDto>;
export const InboxMessageDto = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  direction: z.enum(['inbound', 'outbound']),
  sender: z.enum(['customer', 'human', 'bot']),
  text: z.string(),
  status: z.enum(['received', 'pending', 'sent', 'failed', 'unknown']),
  failureCode: z.string().nullable(),
  externalId: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type InboxMessageDto = z.infer<typeof InboxMessageDto>;
export const ConversationListQuery = z.object({
  provider: MetaProvider.optional(),
  status: z.enum(['open', 'resolved']).optional(),
  mode: z.enum(['human', 'bot']).optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ConversationListQuery = z.infer<typeof ConversationListQuery>;
export const ConversationListResponse = z.object({ data: z.array(ConversationDto) });
export const ConversationDetailDto = z.object({
  conversation: ConversationDto,
  messages: z.array(InboxMessageDto),
});
export type ConversationDetailDto = z.infer<typeof ConversationDetailDto>;
export const SendInboxMessageRequest = z.object({
  text: z.string().trim().min(1).max(2000),
  idempotencyKey: z.uuid(),
});
export type SendInboxMessageRequest = z.infer<typeof SendInboxMessageRequest>;
export const UpdateConversationRequest = z.object({
  mode: z.enum(['human', 'bot']).optional(),
  status: z.enum(['open', 'resolved']).optional(),
  assignToMe: z.boolean().optional(),
  note: z.string().max(10000).optional(),
});
export type UpdateConversationRequest = z.infer<typeof UpdateConversationRequest>;
