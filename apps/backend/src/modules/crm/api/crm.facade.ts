import type {
  ContactDto,
  ConversationTagAssignmentDto,
  ConversationTagChip,
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
      sourceKey: 'website' | 'facebook' | 'instagram';
      displayName: string;
      firstUrl: string | null;
    },
  ): Promise<{ contactId: string; created: boolean }>;
  /** The customer with this E.164 phone, or null. Never creates one. */
  findContactIdByPhone(workspaceId: WorkspaceId, phoneE164: string): Promise<string | null>;
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
}

export const CRM_FACADE = Symbol('CRM_FACADE');
