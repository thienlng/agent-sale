import type { Capability } from '@agent-sales/contracts';
import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { UserId, WorkspaceId } from '@agent-sales/shared';
import type { FastifyRequest } from 'fastify';

import { ApiError } from './api-error.js';

/**
 * Request-scoped auth state written by the global AuthGuard (identity module)
 * and read by controllers through the decorators below. Controllers never
 * parse headers themselves.
 */
export interface AuthState {
  userId: UserId;
  sessionId: string;
  /** The member's role in the workspace of a @WorkspaceScoped() route. */
  role?: string | undefined;
  /**
   * The user's display name, looked up on first call only (reads never pay for it).
   * Mutations use it to stamp audit events without importing the identity module.
   */
  displayName?: (() => Promise<string | null>) | undefined;
  /**
   * Set when the request authenticated with a workspace API key (ADR-022): `userId` is then the
   * key's creator, `role` the key's effective capabilities (`apiKeyRole`) and `displayName`
   * answers `API: <key name>`.
   */
  apiKey?: { id: string; name: string } | undefined;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthState;
    workspaceId?: WorkspaceId;
  }
}

export const IS_PUBLIC = 'rapiz:isPublic';
export const IS_WORKSPACE_SCOPED = 'rapiz:isWorkspaceScoped';
export const IS_PLATFORM_ADMIN = 'rapiz:isPlatformAdmin';
export const REQUIRED_CAPABILITY = 'rapiz:requiredCapability';
export const REQUIRES_RECENT_AUTH = 'rapiz:requiresRecentAuth';

/** Route needs no authentication (health, signup, login, refresh). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Route acts on one workspace: the guard reads `X-Workspace-Id`, verifies the
 * user is an active member, and exposes it via @CurrentWorkspace(). A
 * workspace the user does not belong to answers 404 (never 403).
 */
export const WorkspaceScoped = () => SetMetadata(IS_WORKSPACE_SCOPED, true);

/**
 * Platform back-office route (LLM providers, plans…): the user must be a
 * platform admin. Anyone else gets 404 so the admin surface is not discoverable.
 * An admin also needs two-factor turned on (403 `admin_mfa_required`) and a
 * session that passed it (403 `mfa_session_required`: step up with a code).
 */
export const PlatformAdmin = () => SetMetadata(IS_PLATFORM_ADMIN, true);

/**
 * Workspace route that needs a capability of the member's role
 * (`ROLE_CAPABILITIES` in contracts). A member without it gets 403: they know
 * the workspace, just not this action.
 */
export const RequireCapability = (capability: Capability) =>
  SetMetadata(REQUIRED_CAPABILITY, capability);

/**
 * Sensitive action (step-up): the session must have proved a factor within
 * `AUTH_STEP_UP_WINDOW_MINUTES` (login, Google sign-in or `POST /auth/reauth`);
 * otherwise 403 with `details.reason = 'reauth_required'`. Never satisfied by an API key.
 */
export const RequireRecentAuth = () => SetMetadata(REQUIRES_RECENT_AUTH, true);

export const CurrentUser = createParamDecorator((_d: unknown, ctx: ExecutionContext): AuthState => {
  const req = ctx.switchToHttp().getRequest<FastifyRequest>();
  if (!req.auth) throw new ApiError('UNAUTHENTICATED', 'Authentication required');
  return req.auth;
});

export const CurrentWorkspace = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext): WorkspaceId => {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    if (!req.workspaceId) {
      throw new ApiError('INTERNAL', 'Route uses @CurrentWorkspace without @WorkspaceScoped');
    }
    return req.workspaceId;
  },
);
