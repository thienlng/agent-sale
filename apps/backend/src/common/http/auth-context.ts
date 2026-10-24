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
 */
export const PlatformAdmin = () => SetMetadata(IS_PLATFORM_ADMIN, true);

/**
 * Workspace route that needs a capability of the member's role
 * (`ROLE_CAPABILITIES` in contracts). A member without it gets 403: they know
 * the workspace, just not this action.
 */
export const RequireCapability = (capability: Capability) =>
  SetMetadata(REQUIRED_CAPABILITY, capability);

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
