import { z } from 'zod';

/**
 * Payloads of the conversation events the inbox writes to the outbox
 * ("conversation.<thing>.<verb>.v<n>"). Only what statistics read is declared;
 * fields added later are optional so events written before them still parse.
 * The outbox row carries the event type and the conversation id (`aggregateId`).
 */
export const MessageReceivedPayload = z.object({
  messageId: z.string(),
  /** `echo` is a message sent from outside the app (staff using the page inbox). */
  type: z.string(),
  channelId: z.uuid().optional(),
  /** Bot bound to the channel when it happened (ADR-012); kept when the page is rebound later. */
  botId: z.uuid().optional(),
  occurredAt: z.iso.datetime().optional(),
  /** This message opened the conversation. */
  firstMessage: z.boolean().default(false),
});
export type MessageReceivedPayload = z.infer<typeof MessageReceivedPayload>;

export const ReplyCompletedPayload = z.object({
  messageId: z.string(),
  /** `sent` once the provider accepted it. */
  status: z.string(),
  channelId: z.uuid().optional(),
  /** Bot bound to the channel when the reply completed (ADR-012). */
  botId: z.uuid().optional(),
  sender: z.enum(['bot', 'human']).optional(),
  occurredAt: z.iso.datetime().optional(),
});
export type ReplyCompletedPayload = z.infer<typeof ReplyCompletedPayload>;
