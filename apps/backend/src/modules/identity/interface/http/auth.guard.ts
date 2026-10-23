import { workspaceId as toWorkspaceId } from '@agent-sales/shared';
import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { ApiError } from '../../../../common/http/api-error.js';
import { IS_PUBLIC, IS_WORKSPACE_SCOPED } from '../../../../common/http/auth-context.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../../workspace/api/index.js';
import { ACCESS_TOKENS, type AccessTokens } from '../../application/ports/security.js';

/**
 * The ONE global guard (registered as APP_GUARD by IdentityModule):
 * 1. every route requires a valid bearer access token unless @Public();
 * 2. @WorkspaceScoped() routes also require X-Workspace-Id to name a workspace
 *    the user is an active member of — otherwise 404 (never 403, Rule 07).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(ACCESS_TOKENS) private readonly tokens: AccessTokens,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const claims = token ? await this.tokens.verify(token) : null;
    if (!claims) throw new ApiError('UNAUTHENTICATED', 'Authentication required');
    req.auth = { userId: claims.userId, sessionId: claims.sessionId };

    if (this.reflector.getAllAndOverride<boolean>(IS_WORKSPACE_SCOPED, targets)) {
      const raw = req.headers['x-workspace-id'];
      const value = Array.isArray(raw) ? raw[0] : raw;
      if (!value) throw new ApiError('VALIDATION_FAILED', 'X-Workspace-Id header is required');
      let ws;
      try {
        ws = toWorkspaceId(value);
      } catch {
        throw new ApiError('VALIDATION_FAILED', 'Invalid X-Workspace-Id');
      }
      const membership = await this.workspaces.findMembership(ws, claims.userId);
      if (!membership) throw new ApiError('NOT_FOUND', 'Workspace not found');
      req.workspaceId = ws;
    }
    return true;
  }
}
