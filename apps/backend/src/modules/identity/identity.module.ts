import type { Database } from '@agent-sales/db';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { DB_SYSTEM } from '../../common/db/db.module.js';
import { getEnv } from '../../common/config.js';
import { SECRET_BOX, SecretBox } from '../../common/security/secret-box.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { IDENTITY_FACADE } from './api/identity.facade.js';
import {
  AccountQueries,
  LoginHandler,
  RefreshHandler,
  SignupHandler,
} from './application/commands/auth.handlers.js';
import { ACCESS_TOKENS, ATTEMPT_LIMITER, PASSWORD_HASHER } from './application/ports/security.js';
import { MfaService } from './application/mfa.service.js';
import { SessionService } from './application/sessions.js';
import { MFA_REPOSITORY } from './domain/ports/mfa.repository.js';
import { SESSION_REPOSITORY } from './domain/ports/session.repository.js';
import { USER_REPOSITORY } from './domain/ports/user.repository.js';
import {
  DrizzleMfaRepository,
  DrizzleSessionRepository,
  DrizzleUserRepository,
} from './infrastructure/persistence/identity.drizzle-repositories.js';
import {
  InMemoryMfaRepository,
  InMemorySessionRepository,
  InMemoryUserRepository,
} from './infrastructure/persistence/identity.in-memory-repositories.js';
import { Argon2PasswordHasher } from './infrastructure/security/argon2-password-hasher.js';
import { InMemoryAttemptLimiter } from './infrastructure/security/in-memory-attempt-limiter.js';
import { JoseAccessTokens } from './infrastructure/security/jose-access-tokens.js';
import { AUTH_HTTP_OPTIONS } from './interface/http/auth-http.options.js';
import { AuthController } from './interface/http/auth.controller.js';
import { AuthGuard } from './interface/http/auth.guard.js';

/**
 * Users, sessions, tokens and the global AuthGuard. Persistence uses the
 * app_system connection (identity is cross-tenant); in-memory without a DB.
 */
@Module({
  imports: [WorkspaceModule],
  controllers: [AuthController],
  providers: [
    SessionService,
    MfaService,
    SignupHandler,
    LoginHandler,
    RefreshHandler,
    AccountQueries,
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
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: IDENTITY_FACADE, useExisting: AccountQueries },
  ],
  exports: [IDENTITY_FACADE],
})
export class IdentityModule {}
