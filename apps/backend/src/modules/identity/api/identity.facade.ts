import type { ApiKeyDto, CreateApiKeyRequest, CreatedApiKey } from '@agent-sales/contracts';
import type { UserId, WorkspaceId } from '@agent-sales/shared';

/** PUBLIC CONTRACT of the identity module for other modules. */
export interface IdentityFacade {
  /** Display name of a user (snapshotted by modules that record who did what), or null. */
  displayName(userId: UserId): Promise<string | null>;
  /** Name and email of a user (member lists, invitation checks), or null. */
  profile(userId: UserId): Promise<{ name: string; email: string } | null>;
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

/**
 * Delegated access (ADR-023): in-process callers whose work can outlive the caller's 15-min
 * access token (the owner assistant's route tools and approved proposals) trade a valid
 * `Authorization: Bearer <access token>` for a short-lived token of the same user and session.
 */
export interface IdentityDelegationFacade {
  /**
   * A bare token (no `Bearer ` prefix) valid for `ttlSeconds` (1 s to 10 min), or null when the
   * header is not a valid, non-delegated access token. Hold it in memory only: never log or store it.
   */
  delegate(authorization: string, ttlSeconds: number): Promise<string | null>;
}

export const IDENTITY_DELEGATION_FACADE = Symbol('IDENTITY_DELEGATION_FACADE');
