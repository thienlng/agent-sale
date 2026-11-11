import type {
  ConversationCounts,
  ConversationDetailDto,
  ConversationTagAssignmentDto,
  ConversationView,
  ConversationListQuery,
  InboxMessageDto,
  MessageUi,
  WidgetMessageDto,
  SendInboxMessageRequest,
  UpdateConversationRequest,
} from '@agent-sales/contracts';
import type { NormalizedEvent } from '@agent-sales/channels';
import type { WorkspaceId } from '@agent-sales/shared';
export interface ConversationFacade {
  list(
    ws: WorkspaceId,
    query: ConversationListQuery,
    viewerId?: string,
  ): Promise<{ data: ConversationView[]; counts: ConversationCounts }>;
  get(ws: WorkspaceId, id: string): Promise<ConversationDetailDto>;
  send(
    ws: WorkspaceId,
    id: string,
    input: SendInboxMessageRequest,
    actorId: string,
  ): Promise<InboxMessageDto>;
  update(
    ws: WorkspaceId,
    id: string,
    input: UpdateConversationRequest,
    actorId: string,
  ): Promise<ConversationView>;
  /** Active tags of a conversation (the tag library belongs to crm). */
  listTags(ws: WorkspaceId, id: string): Promise<ConversationTagAssignmentDto[]>;
  addTag(
    ws: WorkspaceId,
    id: string,
    input: unknown,
    actorId: string,
  ): Promise<{ created: boolean; assignment: ConversationTagAssignmentDto }>;
  markRead(ws: WorkspaceId, id: string, actorId: string): Promise<ConversationView>;
  /**
   * A website visitor left a phone number or an email: sets `lead` (unseen) on the conversation.
   * Idempotent for the same contact, phone and email; anything new replaces the lead, and a
   * different contact becomes the conversation's customer (`contactId`), with the bot recorded on
   * it. Throws NOT_FOUND.
   */
  linkLead(
    ws: WorkspaceId,
    id: string,
    lead: {
      contactId: string;
      phoneE164: string | null;
      email?: string | null;
      capturedAt: string;
    },
  ): Promise<void>;
  markUnread(ws: WorkspaceId, id: string): Promise<ConversationView>;
  addNote(ws: WorkspaceId, id: string, text: string, actorId: string): Promise<ConversationView>;
  /**
   * Best-effort name and avatar lookup after a customer message; at most one Meta call per
   * conversation per day. Never throws.
   */
  refreshCustomerProfile(ws: WorkspaceId, id: string): Promise<void>;
  /** Bot-initiated hand-over to staff; resumes the bot automatically after the takeover window. */
  handOff(ws: WorkspaceId, id: string, actorId: string): Promise<ConversationView>;
  receive(ws: WorkspaceId, channelId: string, event: NormalizedEvent): Promise<ConversationView>;
  /**
   * What a website visitor may see of their own conversation: their messages and the bot/staff
   * messages that were sent (never notes, failed or unknown messages, nor staff identities), as
   * widget messages ordered by id ascending. `afterMessageId` is an exclusive cursor.
   */
  listForVisitor(
    ws: WorkspaceId,
    channelId: string,
    customerId: string,
    afterMessageId: string | null,
    limit?: number,
  ): Promise<{ conversationId: string | null; messages: WidgetMessageDto[] }>;
  getReplyContext(
    ws: WorkspaceId,
    id: string,
  ): Promise<ConversationDetailDto & { revision: number }>;
  /**
   * Whether the bot still holds the conversation (mode `bot`, status `open`): one primary-key
   * read without a row lock, cheap enough for the agent loop's interrupt poll. False when it
   * does not exist.
   */
  botHolds(ws: WorkspaceId, id: string): Promise<boolean>;
  /**
   * `quickReplies`: buttons under this bubble; delivery only, not stored. Meta shows them; website:
   * accepted, not yet delivered to the widget. `ui` (website only, ADR-029): product cards and
   * suggested next steps, stored on the message and served to the widget; ignored elsewhere.
   */
  commitBotReply(
    ws: WorkspaceId,
    id: string,
    input: { revision: number; text: string; idempotencyKey: string } & BotQuickReplies,
  ): Promise<InboxMessageDto | null>;
  /** A further bubble of an answer whose first bubble was committed (same rules, no revision check). */
  commitBotFollowUp(
    ws: WorkspaceId,
    id: string,
    input: { text: string; idempotencyKey: string } & BotQuickReplies,
  ): Promise<InboxMessageDto | null>;
  /**
   * Attachments of a bot reply as ONE message: several images arrive as a single album (Meta takes
   * up to 10), a video always goes alone (T-192); https URLs only. Same delivery path, idempotency
   * and 24-hour window as the text; null when a human took over meanwhile. A failed send is stored
   * as a failed outbound message and returned, never thrown.
   */
  commitBotAttachments(
    ws: WorkspaceId,
    id: string,
    input: { attachments: readonly BotAttachment[]; idempotencyKey: string },
  ): Promise<InboxMessageDto | null>;
  /**
   * Open conversations waiting for a reply since `olderThan` or earlier (owner reports, T-172):
   * how many, the oldest wait, the split by channel kind (`facebook`, `instagram`, `website`…)
   * and up to `limit` (≤ 200) ids, oldest first, for an alert fingerprint. No customer data.
   */
  awaitingReply(ws: WorkspaceId, q: { olderThan: Date; limit: number }): Promise<AwaitingReply>;
  /**
   * What the Business Brain evaluates (spec 2026-11-11 §3.3): the text messages after `after`
   * (exclusive; all when null), at most the last 40 and 8 000 characters, oldest first, and the
   * conversation's facts. Null when the conversation does not exist in the workspace.
   */
  signalContext(ws: WorkspaceId, id: string, after: Date | null): Promise<SignalContext | null>;
  /**
   * What the Today screen may show (spec 2026-11-11 §5): the conversations with these ids, plus
   * the open ones waiting since `awaitingBefore` or earlier and the ones with a follow-up reminder
   * due by `followUpBefore` (spam left out), at most `limit` (≤ 1 000), most recently updated
   * first. No message text.
   * - `visibleTo`: only the conversations assigned to that member or to nobody (sales and care),
   *   applied before the limit.
   * - `lastHumanFor`: `lastHumanReplyAt` is read for these ids only (null for the others); all
   *   when absent.
   */
  todayCandidates(ws: WorkspaceId, q: TodayCandidatesQuery): Promise<TodayConversation[]>;
  /**
   * What the care agent checks before a follow-up (spec 2026-11-11 care §3): who holds the
   * conversation, its status and channel, and when the customer, a person of the shop and the
   * bot last wrote. Null when it does not exist in the workspace. No message text.
   */
  followUpFacts(ws: WorkspaceId, id: string): Promise<FollowUpFacts | null>;
  /**
   * Sends a care agent message (ADR-031) as a bot message marked `source: 'care'`: the
   * conversation must be open and inside the channel's window (never a message tag); it does not
   * take the conversation from the bot or from a person. Idempotent by `idempotencyKey`. Throws
   * NOT_FOUND, CONFLICT (not open, window closed) or VALIDATION_FAILED (empty or > 2 000 chars). A
   * failed delivery is stored as a failed message and returned, never thrown.
   */
  commitCareMessage(
    ws: WorkspaceId,
    id: string,
    input: { text: string; idempotencyKey: string },
  ): Promise<InboxMessageDto>;
  /**
   * The delivered outbound messages (bot and staff, with the care marker) of these conversations
   * (≤ 1 000 ids) sent in `[since, until)`, oldest first per conversation; at most 20 000 rows. For
   * the care agent's attribution ("Rapiz đã mang lại"). No message text.
   */
  outboundTimeline(
    ws: WorkspaceId,
    ids: readonly string[],
    range: { since: Date; until: Date },
  ): Promise<TimelineEntry[]>;
}
/** What `followUpFacts` returns (ISO times; null when it never happened). */
export interface FollowUpFacts {
  id: string;
  provider: string;
  status: 'open' | 'resolved' | 'spam';
  mode: 'bot' | 'human';
  assigneeId: string | null;
  lastInboundAt: string | null;
  lastMessageSender: 'customer' | 'human' | 'bot';
  /** The last message a person of the shop sent that did not fail (inbox or Page echo). */
  lastHumanAt: string | null;
}
/** One delivered outbound message of `outboundTimeline`. */
export interface TimelineEntry {
  conversationId: string;
  sender: 'bot' | 'human';
  /** `care`: written by the care agent. */
  source: 'care' | null;
  /** ISO time. */
  at: string;
}
/** What `todayCandidates` reads. */
export interface TodayCandidatesQuery {
  ids: readonly string[];
  awaitingBefore: Date;
  followUpBefore: Date;
  limit: number;
  visibleTo?: string | undefined;
  lastHumanFor?: readonly string[] | undefined;
}
/** One conversation as the Today screen reads it. */
export interface TodayConversation {
  id: string;
  provider: string;
  status: 'open' | 'resolved' | 'spam';
  contactId: string | null;
  customerName: string;
  customerAvatarUrl: string | null;
  assigneeId: string | null;
  /** ISO times. */
  awaitingSince: string | null;
  lastInboundAt: string | null;
  followUpAt: string | null;
  followUpNote: string;
  /** Time of the last message a person of the shop sent (not failed); null when none. */
  lastHumanReplyAt: string | null;
}
/** One message as the Business Brain reads it. */
export interface SignalContextMessage {
  sender: 'customer' | 'human' | 'bot';
  text: string;
  /** ISO time. */
  at: string;
}
/** What `signalContext` returns. */
export interface SignalContext {
  messages: SignalContextMessage[];
  facts: {
    status: 'open' | 'resolved' | 'spam';
    contactId: string | null;
    assigneeId: string | null;
    customerName: string;
    awaitingSince: string | null;
    lastInboundAt: string | null;
    lastMessageSender: 'customer' | 'human' | 'bot';
    /** Test or playground conversation: never evaluated. Inbox conversations are never tests. */
    isTest: boolean;
  };
}
/** What `awaitingReply` returns: counts and ids only (S3-R9). */
export interface AwaitingReply {
  count: number;
  /** ISO time of the longest wait; null when nothing waits. */
  oldestSince: string | null;
  byChannel: { channel: string; count: number }[];
  ids: string[];
}
export interface BotQuickReplies {
  quickReplies?: readonly { title: string; payload: string }[] | undefined;
  ui?: MessageUi | undefined;
}
/** One attachment of a bot message (T-192). */
export interface BotAttachment {
  type: 'image' | 'video';
  url: string;
}
export const CONVERSATION_FACADE = Symbol('CONVERSATION_FACADE');
/** Agent entry capability; never started by the HTTP process. */
export interface ConversationRunner {
  tick(): Promise<void>;
}
export const CONVERSATION_RUNNER = Symbol('CONVERSATION_RUNNER');
