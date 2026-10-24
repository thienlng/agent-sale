import type { ContactDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

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
}

export const CRM_FACADE = Symbol('CRM_FACADE');
