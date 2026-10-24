import type { ContactDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

/** PUBLIC CONTRACT of the crm module (inbox, orders and analytics use it later). */
export interface CrmFacade {
  /** Throws NOT_FOUND when the customer does not exist in the workspace. */
  getContact(workspaceId: WorkspaceId, contactId: string): Promise<ContactDto>;
}

export const CRM_FACADE = Symbol('CRM_FACADE');
