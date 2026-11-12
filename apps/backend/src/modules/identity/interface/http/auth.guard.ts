import { API_KEY_PREFIX, apiKeyRole, type Capability, roleCan } from '@agent-sales/contracts';
import { type UserId, type WorkspaceId, workspaceId as toWorkspaceId } from '@agent-sales/shared';
import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { ApiError } from '../../../../common/http/api-error.js';
import {
  IS_PLATFORM_ADMIN,
  IS_PUBLIC,
  IS_WORKSPACE_SCOPED,
  REQUIRED_CAPABILITY,
  REQUIRES_RECENT_AUTH,
} from '../../../../common/http/auth-context.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../../workspace/api/index.js';
import { ApiKeyService } from '../../application/api-key.service.js';
import { AccountQueries } from '../../application/commands/auth.handlers.js';
import { MfaService } from '../../application/mfa.service.js';
import { SessionService } from '../../application/sessions.js';
import { API_RATE_LIMITER, type ApiRateLimiter } from '../../application/ports/api-keys.js';
import { ACCESS_TOKENS, type AccessTokens } from '../../application/ports/security.js';
import { apiKeyRouteSet } from './api-key-routes.js';

const RATE_WINDOW_MS = 60_000;

/**
 * The ONE global guard (registered as APP_GUARD by IdentityModule):
 * 1. every route requires a valid bearer access token unless @Public(), whose session (`sid`) still
 *    exists and is not revoked (cached per process, `AUTH_SESSION_CACHE_TTL_MS`) — otherwise 401;
 * 2. @WorkspaceScoped() routes also require X-Workspace-Id to name a workspace
 *    the user is an active member of — otherwise 404 (never 403, Rule 07);
 * 3. @PlatformAdmin() routes require users.is_platform_admin — otherwise 404 — and then two-factor
 *    turned on (403 `admin_mfa_required`) and a session that passed it (403 `mfa_session_required`);
 * 4. @RequireCapability() routes require the member's role to have it — otherwise 403;
 * 5. @RequireRecentAuth() routes require a step-up within the window — otherwise 403
 *    `reauth_required` (read fresh, not from the cache).
 *
 * A delegated token (ADR-024, the assistant acting for its owner) never passes @PlatformAdmin()
 * or @RequireRecentAuth() routes (404, like any route it has no business on): the assistant only
 * calls workspace routes of its catalog, and none of those is either.
 *
 * A `Bearer rpz_live_…` workspace API key (ADR-022) is accepted only on routes whose contract
 * says `apiKey: true` (any other route answers 404); the request then acts for the key's creator
 * in the key's workspace with the capabilities `scopes ∩ creator's role`, within the plan's
 * per-minute rate limit.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(ACCESS_TOKENS) private readonly tokens: AccessTokens,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
    @Inject(AccountQueries) private readonly accounts: AccountQueries,
    @Inject(ApiKeyService) private readonly apiKeys: ApiKeyService,
    @Inject(API_RATE_LIMITER) private readonly limiter: ApiRateLimiter,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(MfaService) private readonly mfa: MfaService,
  ) {}

  readonly #apiKeyRoutes = apiKeyRouteSet();

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (token?.startsWith(API_KEY_PREFIX)) return this.#apiKey(ctx, req, token);
    const claims = token ? await this.tokens.verify(token) : null;
    if (!claims) throw new ApiError('UNAUTHENTICATED', 'Authentication required');
    const session = await this.sessions.state(claims.sessionId);
    // Logout, password reset and two-factor changes revoke sessions: their access tokens end too.
    if (!session || session.revoked || session.userId !== claims.userId)
      throw new ApiError('UNAUTHENTICATED', 'Session is no longer valid', {
        reason: 'session_revoked',
      });
    const platformAdmin = this.reflector.getAllAndOverride<boolean>(IS_PLATFORM_ADMIN, targets);
    const recentAuth = this.reflector.getAllAndOverride<boolean>(REQUIRES_RECENT_AUTH, targets);
    // Defense in depth: a delegated token carries the owner's session (and its step-up), but the
    // assistant has no business in the back office or on step-up actions.
    if (claims.delegated && (platformAdmin || recentAuth))
      throw new ApiError('NOT_FOUND', 'Not found');
    let name: Promise<string | null> | undefined;
    req.auth = {
      userId: claims.userId,
      sessionId: claims.sessionId,
      displayName: () => (name ??= this.accounts.displayName(claims.userId)),
    };

    if (platformAdmin) {
      if (!(await this.accounts.isPlatformAdmin(claims.userId))) {
        throw new ApiError('NOT_FOUND', 'Not found');
      }
      await this.#adminTwoFactor(claims.userId, claims.sessionId, session.mfa);
    }

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
      // `reason` lets the client tell a lost business from a missing resource (T-079).
      if (!membership)
        throw new ApiError('NOT_FOUND', 'Workspace not found', { reason: 'workspace_access' });
      req.workspaceId = ws;
      req.auth.role = membership.role;
      const needed = this.reflector.getAllAndOverride<Capability | undefined>(
        REQUIRED_CAPABILITY,
        targets,
      );
      if (needed && !roleCan(membership.role, needed)) {
        throw new ApiError('FORBIDDEN', 'Your role cannot do this', { capability: needed });
      }
    }

    if (recentAuth) {
      // Fresh: a step-up made a moment ago, maybe in another process, must count.
      const fresh = await this.sessions.state(claims.sessionId, true);
      if (!fresh || !this.sessions.isRecent(fresh))
        throw new ApiError('FORBIDDEN', 'Confirm it is you to continue', {
          reason: 'reauth_required',
        });
    }
    return true;
  }

  /**
   * The back office moves money and plans of every tenant: a password alone is not enough. The
   * admin turns two-factor on in their account security (no admin route needed, so nobody is
   * locked out) and steps up with a code when the session predates it.
   */
  async #adminTwoFactor(userId: UserId, sessionId: string, cachedMfa: boolean): Promise<void> {
    if (!(await this.mfa.isEnabled(userId)))
      throw new ApiError('FORBIDDEN', 'Turn on two-factor authentication to use the back office', {
        reason: 'admin_mfa_required',
      });
    if (cachedMfa) return;
    if (!(await this.sessions.state(sessionId, true))?.mfa)
      throw new ApiError('FORBIDDEN', 'Confirm it is you with a two-factor code', {
        reason: 'mfa_session_required',
      });
  }

  async #apiKey(ctx: ExecutionContext, req: FastifyRequest, token: string): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    // Only routes marked `apiKey: true` exist for a key; this also keeps every key off
    // platform-admin, session and settings routes.
    if (!this.#apiKeyRoutes.has(`${req.method} ${req.routeOptions.url ?? ''}`))
      throw new ApiError('NOT_FOUND', 'Not found');
    const verified = await this.apiKeys.verify(token);
    if (!verified.ok) throw new ApiError('UNAUTHENTICATED', 'Invalid API key');
    const key = verified.principal;
    const raw = req.headers['x-workspace-id'];
    const sent = Array.isArray(raw) ? raw[0] : raw;
    if (sent && sent !== key.workspaceId)
      throw new ApiError('NOT_FOUND', 'Workspace not found', { reason: 'workspace_access' });
    if (!(await this.apiKeys.enabled(key.workspaceId)))
      throw new ApiError('FEATURE_LOCKED', 'The public API is not included in this plan', {
        feature: 'feature.public_api',
      });
    await this.#rateLimit(ctx, key.id, key.perMinute);

    const role = apiKeyRole(key.capabilities, key.creatorRole);
    const name = `API: ${key.name}`;
    req.auth = {
      userId: key.userId,
      sessionId: `api-key:${key.id}`,
      role,
      displayName: () => Promise.resolve(name),
      apiKey: { id: key.id, name: key.name },
    };
    req.workspaceId = key.workspaceId as WorkspaceId;
    const needed = this.reflector.getAllAndOverride<Capability | undefined>(
      REQUIRED_CAPABILITY,
      targets,
    );
    // An API-key route without a capability is a contract error (http.spec checks it): refuse.
    if (!needed) throw new ApiError('NOT_FOUND', 'Not found');
    if (!roleCan(role, needed))
      throw new ApiError('FORBIDDEN', 'This API key cannot do this', { capability: needed });
    return true;
  }

  async #rateLimit(ctx: ExecutionContext, keyId: string, perMinute: number | null) {
    if (perMinute === null) return;
    const r = await this.limiter.hit(keyId, perMinute, RATE_WINDOW_MS);
    const reply = ctx.switchToHttp().getResponse<FastifyReply>();
    const reset = Math.ceil(r.resetMs / 1000);
    void reply.header('X-RateLimit-Limit', String(perMinute));
    void reply.header('X-RateLimit-Remaining', String(r.remaining));
    void reply.header('X-RateLimit-Reset', String(reset));
    if (!r.ok) {
      void reply.header('Retry-After', String(reset));
      throw new ApiError('RATE_LIMITED', 'Too many requests for this API key', {
        retryAfterSeconds: reset,
      });
    }
  }
}
