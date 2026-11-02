import type { ApiKeyDto, CreateApiKeyRequest, CreatedApiKey } from '@agent-sales/contracts';
import type { UserId, WorkspaceId } from '@agent-sales/shared';

/** PUBLIC CONTRACT of the identity module for other modules. */
export interface IdentityFacade {
  /** Display name of a user (snapshotted by modules that record who did what), or null. */
  displayName(userId: UserId): Promise<string | null>;
  /**
   * Name, login email and UI language of a user (member lists, invitation checks, notification
   * delivery), or null. `locale` is `vi` unless the user chose `en`.
   */
  profile(userId: UserId): Promise<{ name: string; email: string; locale: 'vi' | 'en' } | null>;
}

/** Platform admin lookups (ADR-021). Callers must already have checked the platform admin flag. */
export interface IdentityAdminFacade {
  /** Users by id (unknown ids are skipped). */
  usersByIds(ids: readonly string[]): Promise<UserRef[]>;
  /** Lookup by email, phone or name (substring, case-insensitive), newest first. */
  searchUsers(q: string, limit: number): Promise<UserRef[]>;
}

export const IDENTITY_ADMIN_FACADE = Symbol('IDENTITY_ADMIN_FACADE');

/** A user as the platform admin sees it. */
export interface UserRef {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

export const IDENTITY_FACADE = Symbol('IDENTITY_FACADE');

/**
 * Workspace API keys (ADR-022 §2): identity owns them (they are credentials); the developer
 * module serves Settings → Developers through this facade. Callers check `developer.manage`.
 */
export interface IdentityApiKeysFacade {
  /** Keys of the workspace, newest first (never the secret). */
  list(workspaceId: WorkspaceId): Promise<ApiKeyDto[]>;
  /** Creates a key acting for `actor`; the full key is in the result only. FEATURE_LOCKED without the plan. */
  create(
    workspaceId: WorkspaceId,
    actor: UserId,
    input: CreateApiKeyRequest,
  ): Promise<CreatedApiKey>;
  /** Revokes a key (idempotent); NOT_FOUND outside the workspace. */
  revoke(workspaceId: WorkspaceId, id: string): Promise<ApiKeyDto>;
}

export const IDENTITY_API_KEYS_FACADE = Symbol('IDENTITY_API_KEYS_FACADE');
