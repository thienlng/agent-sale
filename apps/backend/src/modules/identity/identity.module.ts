import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { DB_SYSTEM } from '../../common/db/db.module.js';
import { getEnv } from '../../common/config.js';
import { createMailer, MAILER } from '../../common/email/mailer.js';
import { SECRET_BOX, SecretBox } from '../../common/security/secret-box.js';
import { AccountModule } from '../account/account.module.js';
import { BILLING_FACADE, type BillingFacade } from '../billing/api/index.js';
import { BillingModule } from '../billing/billing.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import {
  IDENTITY_ADMIN_FACADE,
  IDENTITY_API_KEYS_FACADE,
  IDENTITY_FACADE,
} from './api/identity.facade.js';
import { ApiKeyService } from './application/api-key.service.js';
import { BillingApiPlanGate } from './application/api-plan-gate.js';
import {
  AccountQueries,
  LoginHandler,
  PasswordResetHandler,
  RefreshHandler,
  SignupBusinessHandler,
  SignupHandler,
} from './application/commands/auth.handlers.js';
import { EmailCodeService } from './application/email-codes.js';
import {
  API_KEY_STORE,
  API_PLAN_GATE,
  API_RATE_LIMITER,
  IDEMPOTENCY_STORE,
} from './application/ports/api-keys.js';
import { ACCESS_TOKENS, ATTEMPT_LIMITER, PASSWORD_HASHER } from './application/ports/security.js';
import { MfaService } from './application/mfa.service.js';
import { SessionService } from './application/sessions.js';
import { EMAIL_CODE_REPOSITORY } from './domain/ports/email-code.repository.js';
import { MFA_REPOSITORY } from './domain/ports/mfa.repository.js';
import { SESSION_REPOSITORY } from './domain/ports/session.repository.js';
import { USER_REPOSITORY } from './domain/ports/user.repository.js';
import {
  DrizzleEmailCodeRepository,
  DrizzleMfaRepository,
  DrizzleSessionRepository,
  DrizzleUserRepository,
} from './infrastructure/persistence/identity.drizzle-repositories.js';
import {
  InMemoryEmailCodeRepository,
  InMemoryMfaRepository,
  InMemorySessionRepository,
  InMemoryUserRepository,
} from './infrastructure/persistence/identity.in-memory-repositories.js';
import {
  DrizzleApiKeyStore,
  DrizzleIdempotencyStore,
} from './infrastructure/persistence/api-keys.drizzle-store.js';
import {
  InMemoryApiKeyStore,
  InMemoryIdempotencyStore,
} from './infrastructure/persistence/api-keys.in-memory-store.js';
import { Argon2PasswordHasher } from './infrastructure/security/argon2-password-hasher.js';
import { InMemoryAttemptLimiter } from './infrastructure/security/in-memory-attempt-limiter.js';
import { InMemoryApiRateLimiter } from './infrastructure/security/in-memory-rate-limiter.js';
import { PostgresApiRateLimiter } from './infrastructure/security/postgres-rate-limiter.js';
import { JoseAccessTokens } from './infrastructure/security/jose-access-tokens.js';
import { AUTH_HTTP_OPTIONS } from './interface/http/auth-http.options.js';
import { AuthController } from './interface/http/auth.controller.js';
import { AuthGuard } from './interface/http/auth.guard.js';
import { IdempotencyInterceptor } from './interface/http/idempotency.interceptor.js';

/**
 * Users, sessions, tokens, workspace API keys (ADR-022) and the global AuthGuard. Persistence uses the
 * app_system connection (identity is cross-tenant); in-memory without a DB.
 */
@Module({
  imports: [WorkspaceModule, AccountModule, BillingModule],
  controllers: [AuthController],
  providers: [
    SessionService,
    MfaService,
    SignupHandler,
    SignupBusinessHandler,
    PasswordResetHandler,
    EmailCodeService,
    LoginHandler,
    RefreshHandler,
    AccountQueries,
    { provide: MAILER, useFactory: () => createMailer(getEnv()) },
    {
      provide: EMAIL_CODE_REPOSITORY,
      inject: [{ token: DB_SYSTEM, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db ? new DrizzleEmailCodeRepository(db) : new InMemoryEmailCodeRepository(),
    },
    {
      provide: USER_REPOSITORY,
      inject: [{ token: DB_SYSTEM, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db ? new DrizzleUserRepository(db) : new InMemoryUserRepository(),
    },
    {
      provide: SESSION_REPOSITORY,
      inject: [{ token: DB_SYSTEM, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db ? new DrizzleSessionRepository(db) : new InMemorySessionRepository(),
    },
    {
      provide: MFA_REPOSITORY,
      inject: [{ token: DB_SYSTEM, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db ? new DrizzleMfaRepository(db) : new InMemoryMfaRepository(),
    },
    {
      provide: SECRET_BOX,
      useFactory: () => {
        const key = getEnv().SECRETS_ENCRYPTION_KEY;
        return key ? SecretBox.fromBase64(key) : SecretBox.insecureDevelopmentBox();
      },
    },
    { provide: PASSWORD_HASHER, useFactory: () => new Argon2PasswordHasher() },
    { provide: ATTEMPT_LIMITER, useFactory: () => new InMemoryAttemptLimiter() },
    { provide: ACCESS_TOKENS, useFactory: () => JoseAccessTokens.create(getEnv()) },
    {
      provide: AUTH_HTTP_OPTIONS,
      useFactory: () => {
        const env = getEnv();
        return {
          secureCookies: env.NODE_ENV === 'production' || env.COOKIE_SECURE,
          allowedOrigins: env.APP_ORIGINS.split(',')
            .map((o) => o.trim())
            .filter(Boolean),
        };
      },
    },
    {
      provide: API_KEY_STORE,
      inject: [{ token: DB_SYSTEM, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db ? new DrizzleApiKeyStore(db) : new InMemoryApiKeyStore(),
    },
    {
      provide: IDEMPOTENCY_STORE,
      inject: [{ token: DB_SYSTEM, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db ? new DrizzleIdempotencyStore(db) : new InMemoryIdempotencyStore(),
    },
    {
      provide: API_RATE_LIMITER,
      inject: [{ token: DB_SYSTEM, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db ? new PostgresApiRateLimiter(db) : new InMemoryApiRateLimiter(),
    },
    {
      provide: API_PLAN_GATE,
      inject: [BILLING_FACADE],
      useFactory: (billing: BillingFacade) => new BillingApiPlanGate(billing),
    },
    ApiKeyService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: IDENTITY_API_KEYS_FACADE, useExisting: ApiKeyService },
    { provide: IDENTITY_FACADE, useExisting: AccountQueries },
    { provide: IDENTITY_ADMIN_FACADE, useExisting: AccountQueries },
  ],
  exports: [IDENTITY_FACADE, IDENTITY_ADMIN_FACADE, IDENTITY_API_KEYS_FACADE],
})
export class IdentityModule {}
