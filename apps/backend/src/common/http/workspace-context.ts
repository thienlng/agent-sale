import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { workspaceId, type WorkspaceId } from '@agent-sales/shared';
import type { FastifyRequest } from 'fastify';

import { ApiError } from './api-error.js';

/**
 * Resolves the current workspace for a request. Until auth lands (T-003 follow-up)
 * it reads `X-Workspace-Id`; the real guard must verify membership from the
 * session (Rule 07: never trust the header alone).
 */
export const CurrentWorkspace = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): WorkspaceId => {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const raw = req.headers['x-workspace-id'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value) throw new ApiError('UNAUTHENTICATED', 'Missing workspace context');
    try {
      return workspaceId(value);
    } catch {
      throw new ApiError('VALIDATION_FAILED', 'Invalid workspace id');
    }
  },
);
