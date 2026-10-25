import { z } from 'zod';
import { MetaProvider } from '../channel/channel.schema.js';
import { AssignTagRequest, TagAssignmentDto } from '../crm/crm-settings.schema.js';
/** One entry of the conversation's internal notes timeline (never shown to the customer). */
export const ConversationNote = z.object({
  id: z.uuid(),
  /** `null` for a note migrated from the legacy single `note` field. */
  authorId: z.uuid().nullable(),
  authorName: z.string().max(200),
  text: z.string().min(1).max(10000),
  createdAt: z.iso.datetime(),
});
export type ConversationNote = z.infer<typeof ConversationNote>;
export const MAX_CONVERSATION_NOTES = 200;

/** Tag chip carried by a list row; the tag library belongs to the crm module. */
export const ConversationTagChip = z.object({
  id: z.uuid(),
  name: z.string(),
  color: z.string(),
});
export type ConversationTagChip = z.infer<typeof ConversationTagChip>;

export const ConversationDto = z.object({
  id: z.uuid(),
  channelId: z.uuid(),
  provider: MetaProvider,
  customerId: z.string(),
  customerName: z.string(),
  /** Profile picture from Meta; `null` until the profile was fetched (or when Meta refused it). */
  customerAvatarUrl: z.string().max(2000).nullable().default(null),
  /** When the profile was last requested from Meta (success or not); drives the daily retry. */
  profileFetchedAt: z.iso.datetime().nullable().default(null),
  mode: z.enum(['human', 'bot']),
  autoResumeAt: z.iso.datetime().nullable().default(null),
  /**
   * How staff took over: `temporary` resumes the bot at `autoResumeAt`, `permanent` never does.
   * `null` while the bot answers. An implicit takeover (staff reply or Page echo) is `temporary`.
   */
  takeover: z.enum(['temporary', 'permanent']).nullable().default(null),
  status: z.enum(['open', 'resolved']),
  assigneeId: z.uuid().nullable(),
  /** Legacy single note, kept readable; `notes` is the timeline. */
  note: z.string(),
  notes: z.array(ConversationNote).max(MAX_CONVERSATION_NOTES).default([]),
  /** Customer messages nobody in the shop has opened yet (shared by the whole shop). */
  unreadCount: z.number().int().min(0).default(0),
  lastReadAt: z.iso.datetime().nullable().default(null),
  lastReadBy: z.object({ userId: z.string(), name: z.string() }).nullable().default(null),
  /** Set by a customer message while null; cleared by any outbound message (human or bot). */
  awaitingSince: z.iso.datetime().nullable().default(null),
  lastMessageSender: z.enum(['customer', 'human', 'bot']).default('customer'),
  /** Last Vietnamese phone number found in a customer message, as `0xxxxxxxxx`. */
  customerPhone: z.string().max(20).nullable().default(null),
  /** Filled on list and detail reads from the crm tag library; never stored. */
  tags: z.array(ConversationTagChip).default([]),
  followUpAt: z.iso.datetime().nullable().optional(),
  followUpNote: z.string().max(500).optional(),
  revision: z.number().int(),
  lastMessage: z.string(),
  lastInboundAt: z.iso.datetime(),
  createdAt: z.iso.datetime().default(() => new Date(0).toISOString()),
  updatedAt: z.iso.datetime(),
});
/**
 * Wire shape. The fields added by the inbox v2 are optional here so older callers (and fixtures)
 * keep compiling; the server always sends them. Use `ConversationView` when they are required.
 */
export type ConversationDto = z.input<typeof ConversationDto>;
/** Parsed shape with every field present (defaults applied). */
export type ConversationView = z.output<typeof ConversationDto>;
const HttpsUrl = z.url({ protocol: /^https$/ }).max(2000);
/** Meta delivers one attachment per message; text and attachment are sent as separate messages. */
export const InboxAttachment = z.object({
  type: z.enum(['image', 'video', 'audio', 'file', 'sticker']),
  url: HttpsUrl,
});
export type InboxAttachment = z.infer<typeof InboxAttachment>;
export const InboxMessageDto = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  direction: z.enum(['inbound', 'outbound']),
  sender: z.enum(['customer', 'human', 'bot']),
  /** Display name of the staff member who sent it from the inbox; null for bot, customer and Page echoes. */
  senderName: z.string().max(200).nullable().optional(),
  text: z.string(),
  attachments: z.array(InboxAttachment).max(10).default([]),
  status: z.enum(['received', 'pending', 'sent', 'failed', 'unknown']),
  failureCode: z.string().nullable(),
  externalId: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type InboxMessageDto = z.infer<typeof InboxMessageDto>;
/** Uuid lists arrive in a query string as `a,b,c` (or as repeated parameters). */
const queryUuids = z.preprocess(
  (v) =>
    typeof v === 'string'
      ? v
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      : v,
  z.array(z.uuid()).max(50).optional(),
);

/** Query-string booleans arrive as text. */
const queryBool = z.preprocess(
  (v) => (v === 'true' ? true : v === 'false' ? false : v),
  z.boolean().optional(),
);

export const ConversationTab = z.enum(['all', 'unread', 'waiting']);
export type ConversationTab = z.infer<typeof ConversationTab>;

export const ConversationListQuery = z.object({
  provider: MetaProvider.optional(),
  status: z.enum(['open', 'resolved']).optional(),
  mode: z.enum(['human', 'bot']).optional(),
  q: z.string().max(200).optional(),
  /** `unread` and `waiting` narrow the list (default `all`); counts always ignore the tab. */
  tab: ConversationTab.optional(),
  /** `me` is the caller, `none` is unassigned, otherwise a member id. */
  assignee: z.union([z.enum(['me', 'none']), z.uuid()]).optional(),
  channelId: z.uuid().optional(),
  hasPhone: queryBool,
  /** `any`: customer unanswered; `longest`: same, longest wait first; `readNotReplied`: opened but unanswered. */
  waiting: z.enum(['any', 'longest', 'readNotReplied']).optional(),
  /** Tags from the crm library: has any of these. */
  tagsAny: queryUuids,
  /** Has all of these. */
  tagsAll: queryUuids,
  /** Has none of these. */
  tagsExclude: queryUuids,
  /** Has no tag at all. */
  untagged: queryBool,
  sort: z.enum(['recent', 'waitingLongest']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ConversationListQuery = z.infer<typeof ConversationListQuery>;
export const ConversationCounts = z.object({
  all: z.number().int(),
  unread: z.number().int(),
  waiting: z.number().int(),
});
export type ConversationCounts = z.infer<typeof ConversationCounts>;
/** `counts` use every filter except the tab, so the tabs always add up. */
export const ConversationListResponse = z.object({
  data: z.array(ConversationDto),
  counts: ConversationCounts,
});
export type ConversationListResponse = z.infer<typeof ConversationListResponse>;
export const ConversationDetailDto = z.object({
  conversation: ConversationDto,
  messages: z.array(InboxMessageDto),
});
export type ConversationDetailDto = z.infer<typeof ConversationDetailDto>;
export const SendInboxMessageRequest = z
  .object({
    text: z.string().trim().max(2000).default(''),
    attachment: z
      .object({ type: z.enum(['image', 'video', 'audio', 'file']), url: HttpsUrl })
      .optional(),
    idempotencyKey: z.uuid(),
  })
  .refine((b) => b.text.length > 0 !== Boolean(b.attachment), {
    message: 'Send either text or one attachment',
    path: ['text'],
  });
export type SendInboxMessageRequest = z.infer<typeof SendInboxMessageRequest>;
export const UpdateConversationRequest = z
  .object({
    expectedRevision: z.number().int().min(0).optional(),
    followUpAt: z.iso.datetime().nullable().optional(),
    followUpNote: z.string().trim().max(500).optional(),
    mode: z.enum(['human', 'bot']).optional(),
    /** Only with `mode: 'human'`. `temporary` resumes the bot after the bot's takeover minutes. */
    takeover: z.enum(['temporary', 'permanent']).optional(),
    status: z.enum(['open', 'resolved']).optional(),
    assignToMe: z.boolean().optional(),
    /** Any active member of the workspace, or `null` to unassign. Wins over `assignToMe`. */
    assigneeId: z.uuid().nullable().optional(),
    /**
     * Legacy single note. A non-empty value is also appended to the `notes` timeline (author = the
     * caller) unless it equals the current `note`; an empty value only clears the legacy field and
     * never deletes timeline entries. `POST /conversations/{id}/notes` mirrors the newest entry
     * into `note`, so the two paths never lose data.
     */
    note: z.string().max(10000).optional(),
    /** Staff correction of the detected phone: a Vietnamese mobile number, or `null` to clear. */
    customerPhone: z.string().trim().max(30).nullable().optional(),
  })
  .refine((b) => b.takeover === undefined || b.mode === 'human', {
    message: 'takeover needs mode "human"',
    path: ['takeover'],
  });
export type UpdateConversationRequest = z.infer<typeof UpdateConversationRequest>;

export const AddConversationNoteRequest = z.object({
  text: z.string().trim().min(1).max(10000),
});
export type AddConversationNoteRequest = z.infer<typeof AddConversationNoteRequest>;

/** A tag assignment of a conversation, with the chip to draw. Removal uses `/tag-assignments/{id}/remove`. */
export const ConversationTagAssignmentDto = TagAssignmentDto.extend({ tag: ConversationTagChip });
export type ConversationTagAssignmentDto = z.infer<typeof ConversationTagAssignmentDto>;
export const ConversationTagAssignmentList = z.object({
  data: z.array(ConversationTagAssignmentDto),
});
export { AssignTagRequest as AssignConversationTagRequest };
