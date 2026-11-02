import type {
  AdminAccountDetail,
  AdminAccountList,
  AdminAccountListQuery,
  AdminAuditList,
  AdminAuditQuery,
} from '@agent-sales/contracts';

/**
 * PUBLIC CONTRACT of the backoffice module (ADR-021 §6): the platform admin's read views, joined
 * across the account, workspace, identity and billing facades. Writes go straight to the owning
 * module's facade. Platform admins only; nothing else imports this module.
 */
export interface BackofficeFacade {
  /** Accounts with owner, subscription and business count (one batched call per module). */
  listAccounts(query: AdminAccountListQuery): Promise<AdminAccountList>;
  /** NOT_FOUND for an unknown account. */
  accountDetail(accountId: string): Promise<AdminAccountDetail>;
  /** Platform operator audit trail, newest first. */
  listAudit(query: AdminAuditQuery): Promise<AdminAuditList>;
}

export const BACKOFFICE_FACADE = Symbol('BACKOFFICE_FACADE');
