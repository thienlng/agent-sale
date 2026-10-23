import {
  type AuthResponse,
  type BootstrapResponse,
  LoginRequest,
  RefreshRequest,
  SignupRequest,
  type UserDto,
} from '@agent-sales/contracts';
import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { ApiError } from '../../../../common/http/api-error.js';
import { type AuthState, CurrentUser, Public } from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import {
  AccountQueries,
  LoginHandler,
  RefreshHandler,
  SignupHandler,
} from '../../application/commands/auth.handlers.js';
import { type ClientMeta, type IssuedSession, SessionService } from '../../application/sessions.js';
import { AUTH_HTTP_OPTIONS, type AuthHttpOptions } from './auth-http.options.js';

export const REFRESH_COOKIE = 'razpi_rt';
const COOKIE_PATH = '/api/v1/auth';

/**
 * Web clients: refresh token only in an HttpOnly cookie scoped to /api/v1/auth;
 * access token in the body (kept in memory by the SPA). Native clients
 * (`client: native`) get/send the refresh token in the body (docs/09 §2).
 */
@Controller()
export class AuthController {
  constructor(
    @Inject(SignupHandler) private readonly signupHandler: SignupHandler,
    @Inject(LoginHandler) private readonly loginHandler: LoginHandler,
    @Inject(RefreshHandler) private readonly refreshHandler: RefreshHandler,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AccountQueries) private readonly account: AccountQueries,
    @Inject(AUTH_HTTP_OPTIONS) private readonly options: AuthHttpOptions,
  ) {}

  @Public()
  @Post('auth/signup')
  @HttpCode(201)
  async signup(
    @Body(new ZodValidationPipe(SignupRequest)) body: SignupRequest,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthResponse> {
    return this.respond(await this.signupHandler.execute(body, meta(req)), body.client, reply);
  }

  @Public()
  @Post('auth/login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(LoginRequest)) body: LoginRequest,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthResponse> {
    return this.respond(await this.loginHandler.execute(body, meta(req)), body.client, reply);
  }

  @Public()
  @Post('auth/refresh')
  @HttpCode(200)
  async refresh(
    @Body(new ZodValidationPipe(RefreshRequest)) body: RefreshRequest,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthResponse> {
    if (body.client === 'web') this.assertAllowedOrigin(req);
    const raw = body.client === 'native' ? body.refreshToken : req.cookies[REFRESH_COOKIE];
    try {
      return this.respond(await this.refreshHandler.execute(raw, meta(req)), body.client, reply);
    } catch (e) {
      if (body.client === 'web') void reply.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
      throw e;
    }
  }

  @Post('auth/logout')
  @HttpCode(204)
  async logout(
    @CurrentUser() user: AuthState,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.sessions.revoke(user.sessionId);
    void reply.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
  }

  @Get('me')
  me(@CurrentUser() user: AuthState): Promise<UserDto> {
    return this.account.me(user.userId);
  }

  @Get('bootstrap')
  bootstrap(@CurrentUser() user: AuthState): Promise<BootstrapResponse> {
    return this.account.bootstrap(user.userId);
  }

  private respond(
    issued: IssuedSession,
    client: 'web' | 'native',
    reply: FastifyReply,
  ): AuthResponse {
    const base = {
      accessToken: issued.accessToken,
      expiresIn: issued.expiresIn,
      user: issued.user,
    };
    if (client === 'native') return { ...base, refreshToken: issued.refreshToken };
    void reply.setCookie(REFRESH_COOKIE, issued.refreshToken, {
      httpOnly: true,
      secure: this.options.secureCookies,
      sameSite: 'lax',
      path: COOKIE_PATH,
      expires: issued.refreshExpiresAt,
    });
    return base;
  }

  /** CSRF defence for the cookie-authenticated refresh endpoint. */
  private assertAllowedOrigin(req: FastifyRequest): void {
    const origin = req.headers.origin;
    if (origin && !this.options.allowedOrigins.includes(origin)) {
      throw new ApiError('FORBIDDEN', 'Origin not allowed');
    }
  }
}

function meta(req: FastifyRequest): ClientMeta {
  const ua = req.headers['user-agent'];
  return { userAgent: typeof ua === 'string' ? ua.slice(0, 300) : null, ip: req.ip ?? null };
}
