import {
  type AuthProvidersResponse,
  type AuthResponse,
  GoogleCallbackQuery,
  GoogleMfaRequest,
  GoogleStartQuery,
} from '@agent-sales/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { Public } from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import {
  GOOGLE_FLOW_TTL_MS,
  GOOGLE_MFA_TTL_MS,
  googleFailureReason,
  GoogleSignInService,
  safeRedirect,
} from '../../application/google-sign-in.js';
import { AUTH_HTTP_OPTIONS, type AuthHttpOptions } from './auth-http.options.js';
import {
  assertAllowedOrigin,
  clientMeta,
  issueSession,
  setRefreshCookie,
} from './refresh-cookie.js';

const FLOW_COOKIE = 'rapiz_google';
const MFA_COOKIE = 'rapiz_google_mfa';
/** Both cookies only travel to the Google endpoints. */
const COOKIE_PATH = '/api/v1/auth/google';

/**
 * A log-safe description of an unexpected error: its class name and, for a database error, the
 * SQLSTATE of its cause. Never the message (Rule 07: no PII in logs).
 */
export function errorTag(e: unknown): string {
  const name = e instanceof Error && /^\w{1,60}$/.test(e.name) ? e.name : 'unknown';
  const cause = e instanceof Error ? (e.cause as { code?: unknown } | undefined) : undefined;
  const code = cause?.code;
  return typeof code === 'string' && /^[0-9A-Z_]{1,40}$/.test(code) ? `${name} (${code})` : name;
}

/**
 * Sign in with Google (ADR-007). The browser goes to /start, Google, /callback, then back to the
 * SPA's /login with `google=done` (refresh cookie set), `google=mfa` (code still needed) or
 * `google_error=<reason>`. The SPA never sees a Google token.
 */
@Controller('auth')
export class GoogleAuthController {
  readonly #log = new Logger(GoogleAuthController.name);

  constructor(
    @Inject(GoogleSignInService) private readonly google: GoogleSignInService,
    @Inject(AUTH_HTTP_OPTIONS) private readonly options: AuthHttpOptions,
  ) {}

  @Public()
  @Get('providers')
  providers(): AuthProvidersResponse {
    return { google: this.google.enabled };
  }

  @Public()
  @Get('google/start')
  start(
    @Query(new ZodValidationPipe(GoogleStartQuery)) query: GoogleStartQuery,
    @Res() reply: FastifyReply,
  ): void {
    if (!this.google.enabled) {
      this.#toLogin(reply, { google_error: 'unavailable' }, safeRedirect(query.redirect));
      return;
    }
    const { url, flow } = this.google.start(query.redirect);
    void reply.setCookie(FLOW_COOKIE, flow, this.#cookie(GOOGLE_FLOW_TTL_MS));
    void reply.header('cache-control', 'no-store').redirect(url, 302);
  }

  @Public()
  @Get('google/callback')
  async callback(
    @Query(new ZodValidationPipe(GoogleCallbackQuery)) query: GoogleCallbackQuery,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const flow = req.cookies[FLOW_COOKIE];
    void reply.clearCookie(FLOW_COOKIE, { path: COOKIE_PATH });
    try {
      const result = await this.google.callback(query, flow, clientMeta(req));
      if (result.kind === 'mfa') {
        void reply.setCookie(MFA_COOKIE, result.ticket, this.#cookie(GOOGLE_MFA_TTL_MS));
        this.#toLogin(reply, { google: 'mfa' }, result.redirect);
        return;
      }
      setRefreshCookie(result.issued, reply, this.options);
      this.#toLogin(reply, { google: 'done' }, result.redirect);
    } catch (e) {
      const known = googleFailureReason(e);
      // The reason is a fixed word, never a code or token.
      // Never the message: a failed query's message carries its parameters (email, name, sub).
      if (!known) this.#log.warn(`Google sign-in failed: ${errorTag(e)}`);
      const reason = known ?? 'failed';
      this.#toLogin(reply, { google_error: reason }, this.google.redirectOf(flow));
    }
  }

  @Public()
  @Post('google/mfa')
  @HttpCode(200)
  async mfa(
    @Body(new ZodValidationPipe(GoogleMfaRequest)) body: GoogleMfaRequest,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthResponse> {
    assertAllowedOrigin(req, this.options);
    const issued = await this.google.completeMfa(
      req.cookies[MFA_COOKIE],
      body.code,
      clientMeta(req),
    );
    void reply.clearCookie(MFA_COOKIE, { path: COOKIE_PATH });
    return issueSession(issued, 'web', reply, this.options);
  }

  #cookie(ttlMs: number) {
    return {
      httpOnly: true,
      secure: this.options.secureCookies,
      // Lax: the cookie must come back on Google's top-level redirect to /callback.
      sameSite: 'lax' as const,
      path: COOKIE_PATH,
      maxAge: Math.floor(ttlMs / 1000),
    };
  }

  /** Relative, so the browser stays on the host that served the callback. */
  #toLogin(
    reply: FastifyReply,
    params: Record<string, string>,
    redirect: string | undefined,
  ): void {
    const search = new URLSearchParams(params);
    if (redirect) search.set('redirect', redirect);
    void reply.header('cache-control', 'no-store').redirect(`/login?${search.toString()}`, 302);
  }
}
