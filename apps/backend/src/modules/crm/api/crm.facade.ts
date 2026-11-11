import type {
  ContactDto,
  ConversationTagAssignmentDto,
  ConversationTagChip,
  CustomerRequestKind,
  RequestFieldKey,
  TaskDto,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

/** Which conversations the inbox may list, given tag conditions (all ids are tag ids). */
export interface ConversationTagFilter {
  /** Has at least one of these. */
  any?: readonly string[] | undefined;
  /** Has every one of these. */
  all?: readonly string[] | undefined;
  /** Has none of these. */
  exclude?: readonly string[] | undefined;
  /** Has no tag at all. */
  untagged?: boolean | undefined;
}
/** Id sets for the inbox's own query: `include` null means "no narrowing". */
export interface ConversationTagMatch {
  include: string[] | null;
  exclude: string[];
}

/**
 * Outcome of a bot-recorded customer request (ESV spec §5.1). `missing`: the recommended fields
 * still empty. `dateLabel`: the server's "Thứ Bảy 08/11/2026" for a given `preferredDate`.
 * `invalid` problems: zod issues, 'phone: not a phone number', 'missing:<field>', 'past_date',
 * 'kind_not_offered'.
 */
export type BotRequestResult =
  | {
      outcome: 'recorded' | 'updated';
      contactId: string;
      created: boolean;
      missing: RequestFieldKey[];
      dateLabel: string | null;
    }
  | { outcome: 'preview'; missing: RequestFieldKey[]; dateLabel: string | null }
  | { outcome: 'invalid'; problems: string[] };

/** New requests (`contact.request_recorded`, updates left out) of a period: counts only. */
export interface RequestsRecorded {
  count: number;
  byKind: { kind: CustomerRequestKind; count: number }[];
  /** By the requesting customer's current status (`key` null: a custom status). */
  byStatus: { key: string | null; name: string; count: number }[];
}

/** PUBLIC CONTRACT of the crm module (inbox, orders and analytics use it later). */
export interface CrmFacade {
  /** Throws NOT_FOUND when the customer does not exist in the workspace. */
  getContact(workspaceId: WorkspaceId, contactId: string): Promise<ContactDto>;
  /** How many customers a member owns as Sales and as CSKH (removal preview). */
  ownedContactCounts(
    workspaceId: WorkspaceId,
    userId: string,
  ): Promise<{ sales: number; care: number }>;
  /** Display names of customers by id; unknown ids are absent. Callers filter by visibility first. */
  contactNames(
    workspaceId: WorkspaceId,
    ids: readonly string[],
  ): Promise<Map<string, string | null>>;
  /**
   * Moves every customer owned by `from` to `to` (`null` = unassigned), one history
   * entry and one event per customer. Returns how many moved per role.
   */
  reassignContacts(
    workspaceId: WorkspaceId,
    input: { from: string; to: string | null; actor: { userId: string; name: string | null } },
  ): Promise<{ sales: number; care: number }>;

  /**
   * A customer gave a phone number (website lead, or a number in a Facebook/Instagram message):
   * finds the customer by the E.164 phone, or creates one (named `displayName`, source = the
   * built-in source with `sourceKey`). One phone = one customer per business (T-088). An existing
   * customer keeps its first source and gets a history entry. Safe under retries and races:
   * concurrent calls for the same phone end with one customer.
   */
  upsertLeadByPhone(
    workspaceId: WorkspaceId,
    input: {
      phoneE164: string;
      /** `bot`: captured by the AI bot in a conversation; the customer gets no built-in source. */
      sourceKey: 'website' | 'facebook' | 'instagram' | 'bot';
      displayName: string;
      firstUrl: string | null;
      /**
       * When the customer found by phone still has exactly this name (a placeholder an earlier
       * capture generated, e.g. `websiteLeadName`), it is renamed to `displayName`.
       */
      renameFrom?: string;
      /**
       * The customer the same visitor already became (an email left first on the website): when
       * no customer has the phone yet, the phone is added to it instead of creating a second one.
       */
      contactId?: string;
    },
  ): Promise<{ contactId: string; created: boolean }>;
  /**
   * A website visitor left an email: like `upsertLeadByPhone` with the normalized email as the
   * key. `contactId` (the visitor's customer from an earlier phone capture) gets the email when it
   * has none, so one visitor stays one customer.
   */
  upsertLeadByEmail(
    workspaceId: WorkspaceId,
    input: {
      email: string;
      sourceKey: 'website';
      displayName: string;
      firstUrl: string | null;
      renameFrom?: string;
      contactId?: string;
    },
  ): Promise<{ contactId: string; created: boolean }>;
  /**
   * Moves a customer to the status with this built-in `key` as the system (history entry and
   * event, no staff actor). `forwardOnly` never moves a customer back in the pipeline order. An
   * unknown or archived status changes nothing. Returns whether the status changed.
   */
  moveContactStatus(
    workspaceId: WorkspaceId,
    contactId: string,
    statusKey: string,
    opts: { forwardOnly: boolean },
  ): Promise<boolean>;
  /**
   * Adds a note signed `authorName` (no staff author). A repeat of the customer's latest note is
   * skipped. Returns whether it was added.
   */
  addContactNote(
    workspaceId: WorkspaceId,
    contactId: string,
    body: string,
    authorName: string,
  ): Promise<boolean>;
  /**
   * Remembers that a bot answered a conversation linked to the customer (bot filter, history kept
   * across page reassignment). Idempotent. Throws NOT_FOUND for a customer of another business.
   */
  recordContactBot(workspaceId: WorkspaceId, contactId: string, botId: string): Promise<void>;

  /**
   * Tag chips of conversations for list rows (active, non-archived tags, oldest first);
   * conversations without tags are absent from the map.
   */
  conversationTags(
    workspaceId: WorkspaceId,
    conversationIds: readonly string[],
  ): Promise<Map<string, ConversationTagChip[]>>;
  /** Id sets that implement tag any/all/exclude/untagged conditions for the inbox list. */
  conversationIdsByTags(
    workspaceId: WorkspaceId,
    filter: ConversationTagFilter,
  ): Promise<ConversationTagMatch>;
  /** Active tags of one conversation. The caller has checked the conversation exists. */
  listConversationTags(
    workspaceId: WorkspaceId,
    conversationId: string,
  ): Promise<ConversationTagAssignmentDto[]>;
  /** Idempotent per tag (`created: false` when it was already there). Removal: `/tag-assignments/{id}/remove`. */
  assignConversationTag(
    workspaceId: WorkspaceId,
    conversationId: string,
    input: unknown,
    actorUserId: string,
  ): Promise<{ created: boolean; assignment: ConversationTagAssignmentDto }>;
  /**
   * Customers created in `[since, until)` (owner reports, T-172), archived ones left out, split
   * by the name of their first source (`null` = no source). Counts only, no customer data.
   */
  contactsCreated(
    workspaceId: WorkspaceId,
    q: { since: Date; until: Date },
  ): Promise<{ count: number; bySource: { source: string | null; count: number }[] }>;

  /**
   * The bot's `record_request` (saas, education, spa; ADR-020 generalised): finds or creates the
   * customer by phone, moves its status per the industry's `REQUEST_PROFILES` entry, and leaves a
   * history entry and a note signed "Bot AI". `preview` validates and writes nothing. Never
   * throws for bad input: it answers `invalid`.
   */
  recordBotRequest(
    workspaceId: WorkspaceId,
    input: {
      kind: CustomerRequestKind;
      details: unknown;
      preview: boolean;
      /**
       * Names of the catalog products the bot saw in the conversation: an empty course or service
       * is filled from one of them when the goal or note names it (T-187).
       */
      catalogNames?: readonly string[];
    },
  ): Promise<BotRequestResult>;
  /** Requests recorded in `[since, until)` (owner reports `new_requests`); `kinds` limits them. */
  requestsRecorded(
    workspaceId: WorkspaceId,
    q: { since: Date; until: Date; kinds?: readonly CustomerRequestKind[] },
  ): Promise<RequestsRecorded>;

  /**
   * Open tasks with a due time before `dueBefore` (Today, T-4): with `userId`, the tasks assigned
   * to that user and the unassigned ones; without it, every open task. Unless `viewAll` (the
   * user's `contacts.view_all`), unassigned tasks of customers the user may not see are left out.
   */
  countOpenTasks(
    workspaceId: WorkspaceId,
    q: { userId?: string; viewAll?: boolean; dueBefore: Date },
  ): Promise<number>;
  /** Open tasks by due time (undated last), scoped like `countOpenTasks`; at most `limit`. */
  listOpenTasks(
    workspaceId: WorkspaceId,
    q: { userId?: string; viewAll?: boolean; limit: number },
  ): Promise<TaskDto[]>;
}

export const CRM_FACADE = Symbol('CRM_FACADE');

/** Name a website visitor's phone gives a new customer until the customer says their name. */
export function websiteLeadName(phoneE164: string): string {
  return `Khách website ${phoneE164.slice(-4)}`;
}

/** Placeholder name of a website lead who left only an email: the address's local part. */
export function websiteEmailLeadName(email: string): string {
  return `Khách website ${email.split('@')[0]?.slice(0, 40) ?? ''}`.trim();
}
