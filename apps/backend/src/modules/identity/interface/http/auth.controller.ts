import {
  type AuthResponse,
  type BootstrapResponse,
  ForgotPasswordRequest,
  LoginRequest,
  MfaEnableRequest,
  type MfaSetup,
  MfaReauthRequest,
  MfaSetupRequest,
  type MfaStatus,
  type RecoveryCodes,
  RefreshRequest,
  ResetPasswordRequest,
  SignupBusinessRequest,
  type SignupBusinessResponse,
  SignupCodeRequest,
  SignupRequest,
  type UserDto,
} from '@agent-sales/contracts';
import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { type AuthState, CurrentUser, Public } from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import {
  AccountQueries,
  LoginHandler,
  PasswordResetHandler,
  RefreshHandler,
  SignupBusinessHandler,
  SignupHandler,
} from '../../application/commands/auth.handlers.js';
import { MfaService } from '../../application/mfa.service.js';
import { type IssuedSession, SessionService } from '../../application/sessions.js';
import { AUTH_HTTP_OPTIONS, type AuthHttpOptions } from './auth-http.options.js';
import {
  assertAllowedOrigin,
  clientMeta as meta,
  issueSession,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH as COOKIE_PATH,
} from './refresh-cookie.js';

export { REFRESH_COOKIE };

/** Password sign-up and login, sessions and two-factor. Cookie handling: `refresh-cookie.ts`. */
@Controller()
export class AuthController {
  constructor(
    @Inject(SignupHandler) private readonly signupHandler: SignupHandler,
    @Inject(LoginHandler) private readonly loginHandler: LoginHandler,
    @Inject(RefreshHandler) private readonly refreshHandler: RefreshHandler,
    @Inject(PasswordResetHandler) private readonly passwordReset: PasswordResetHandler,
    @Inject(SignupBusinessHandler) private readonly signupBusiness: SignupBusinessHandler,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AccountQueries) private readonly account: AccountQueries,
    @Inject(MfaService) private readonly mfa: MfaService,
    @Inject(AUTH_HTTP_OPTIONS) private readonly options: AuthHttpOptions,
  ) {}

  @Public()
  @Post('auth/signup/code')
  @HttpCode(204)
  async signupCode(
    @Body(new ZodValidationPipe(SignupCodeRequest)) body: SignupCodeRequest,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.signupHandler.requestCode(body, meta(req));
  }

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
  @Post('auth/password/forgot')
  @HttpCode(204)
  async forgotPassword(
    @Body(new ZodValidationPipe(ForgotPasswordRequest)) body: ForgotPasswordRequest,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.passwordReset.forgot(body, meta(req));
  }

  @Public()
  @Post('auth/password/reset')
  @HttpCode(204)
  async resetPassword(
    @Body(new ZodValidationPipe(ResetPasswordRequest)) body: ResetPasswordRequest,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.passwordReset.reset(body, meta(req));
  }

  @Post('auth/signup/business')
  @HttpCode(201)
  createFirstBusiness(
    @CurrentUser() user: AuthState,
    @Body(new ZodValidationPipe(SignupBusinessRequest)) body: SignupBusinessRequest,
  ): Promise<SignupBusinessResponse> {
    return this.signupBusiness.execute(user.userId, body);
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
    if (body.client === 'web') assertAllowedOrigin(req, this.options);
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

  @Get('auth/mfa')
  mfaStatus(@CurrentUser() user: AuthState): Promise<MfaStatus> {
    return this.mfa.status(user.userId);
  }

  @Post('auth/mfa/setup')
  @HttpCode(200)
  mfaSetup(
    @CurrentUser() user: AuthState,
    @Body(new ZodValidationPipe(MfaSetupRequest)) body: MfaSetupRequest,
  ): Promise<MfaSetup> {
    return this.mfa.beginSetup(user.userId, body.password);
  }

  @Post('auth/mfa/enable')
  @HttpCode(200)
  async mfaEnable(
    @CurrentUser() user: AuthState,
    @Body(new ZodValidationPipe(MfaEnableRequest)) body: MfaEnableRequest,
  ): Promise<RecoveryCodes> {
    return { recoveryCodes: await this.mfa.enable(user.userId, body.code, user.sessionId) };
  }

  @Post('auth/mfa/disable')
  @HttpCode(204)
  async mfaDisable(
    @CurrentUser() user: AuthState,
    @Body(new ZodValidationPipe(MfaReauthRequest)) body: MfaReauthRequest,
  ): Promise<void> {
    await this.mfa.disable(user.userId, body.password, body.code, user.sessionId);
  }

  @Post('auth/mfa/recovery-codes')
  @HttpCode(200)
  async mfaRecoveryCodes(
    @CurrentUser() user: AuthState,
    @Body(new ZodValidationPipe(MfaReauthRequest)) body: MfaReauthRequest,
  ): Promise<RecoveryCodes> {
    return {
      recoveryCodes: await this.mfa.regenerateRecoveryCodes(
        user.userId,
        body.password,
        body.code,
        user.sessionId,
      ),
    };
  }

  private respond(
    issued: IssuedSession,
    client: 'web' | 'native',
    reply: FastifyReply,
  ): AuthResponse {
    return issueSession(issued, client, reply, this.options);
  }
}
