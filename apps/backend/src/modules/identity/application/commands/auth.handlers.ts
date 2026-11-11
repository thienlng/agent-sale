import type {
  BootstrapResponse,
  ForgotPasswordRequest,
  LoginRequest,
  ResetPasswordRequest,
  SignupBusinessRequest,
  SignupCodeRequest,
  SignupRequest,
  UserDto,
} from '@agent-sales/contracts';
import { type UserId, workspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { ACCOUNT_FACADE, type AccountFacade } from '../../../account/api/index.js';
import { BILLING_FACADE, type BillingFacade } from '../../../billing/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../../workspace/api/index.js';
import {
  EmailCodeError,
  EmailTakenError,
  InvalidCredentialsError,
  MfaCodeInvalidError,
  MfaRequiredError,
  SessionInvalidError,
  SignupBusinessDoneError,
  TooManyAttemptsError,
} from '../../domain/identity.errors.js';
import { USER_REPOSITORY, type UserRepository } from '../../domain/ports/user.repository.js';
import { assertPasswordAcceptable, User } from '../../domain/user.js';
import {
  ATTEMPT_LIMITER,
  type AttemptLimiter,
  PASSWORD_HASHER,
  type PasswordHasher,
} from '../ports/security.js';
import type { IdentityAdminFacade, IdentityFacade, UserRef } from '../../api/identity.facade.js';
import { EmailCodeService } from '../email-codes.js';
import { MfaService } from '../mfa.service.js';
import { type ClientMeta, type IssuedSession, SessionService, toUserDto } from '../sessions.js';

/**
 * Signup, step 1 (ADR-023): a code emailed to the address, then the user with that code. The user
 * is created with its email already verified; the first business comes after, in step 2
 * (`SignupBusinessHandler`).
 */
@Injectable()
export class SignupHandler {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(ATTEMPT_LIMITER) private readonly limiter: AttemptLimiter,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(EmailCodeService) private readonly codes: EmailCodeService,
  ) {}

  /** `EmailTakenError` for an address with an account; `TooManyAttemptsError` within the minute. */
  async requestCode(input: SignupCodeRequest, meta: ClientMeta): Promise<void> {
    const wait = await this.limiter.hit(`signup-code:${meta.ip ?? 'unknown'}`);
    if (wait > 0) throw new TooManyAttemptsError(wait);
    if (await this.users.findByEmail(input.email)) throw new EmailTakenError();
    await this.codes.send({ email: input.email, name: input.name }, 'signup');
  }

  async execute(input: SignupRequest, meta: ClientMeta): Promise<IssuedSession> {
    const wait = await this.limiter.hit(`signup:${meta.ip ?? 'unknown'}`);
    if (wait > 0) throw new TooManyAttemptsError(wait);
    assertPasswordAcceptable(input.password, { email: input.email, name: input.name });
    if (await this.users.findByEmail(input.email)) throw new EmailTakenError();
    await this.codes.consume(input.email, 'signup', input.code);
    const user = User.register({
      email: input.email,
      name: input.name,
      phone: input.phone,
      passwordHash: await this.hasher.hash(input.password),
      emailVerifiedAt: new Date(),
    });
    await this.users.insert(user);
    return this.sessions.start(user, meta);
  }
}

/**
 * Signup, step 2: the first business of a verified user who owns no account yet (a new account
 * under the user), then the signup trial (ADR-021 §6). Later businesses use `POST /workspaces`.
 * The two writes are in different transactions on purpose: a failed trial never blocks the
 * business, and an operator can start it from /admin.
 */
@Injectable()
export class SignupBusinessHandler {
  readonly #log = new Logger(SignupBusinessHandler.name);

  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(ACCOUNT_FACADE) private readonly accounts: AccountFacade,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
    @Inject(BILLING_FACADE) private readonly billing: BillingFacade,
  ) {}

  async execute(userId: UserId, input: SignupBusinessRequest): Promise<{ workspaceId: string }> {
    const user = await this.users.findById(userId);
    if (!user) throw new SessionInvalidError('user_gone');
    const owned = (await this.accounts.listForUser(userId)).filter((a) => a.role === 'owner');
    if (owned.length) throw new SignupBusinessDoneError();
    const snapshot = user.snapshot();
    const workspace = await this.workspaces.createWorkspace({
      name: input.workspaceName,
      industry: input.industry,
      ownerUserId: user.id,
      owner: { name: snapshot.name, email: snapshot.email, phone: snapshot.phone },
    });
    await this.#startTrial(workspace.id);
    return { workspaceId: workspace.id };
  }

  /** The signup trial (ADR-021 §6) never blocks the first business: an operator can start it from /admin. */
  async #startTrial(ws: string): Promise<void> {
    try {
      const accountId = await this.workspaces.accountOf(workspaceId(ws));
      if (accountId) await this.billing.startSignupTrial(accountId);
    } catch {
      this.#log.error(`Workspace ${ws}: signup trial failed`);
    }
  }
}

/**
 * Forgotten password: a code by email, then a new password with it. Unknown addresses look the
 * same as known ones (no account enumeration). A reset verifies the email (the code proved it)
 * and signs out every session.
 */
@Injectable()
export class PasswordResetHandler {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(ATTEMPT_LIMITER) private readonly limiter: AttemptLimiter,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(EmailCodeService) private readonly codes: EmailCodeService,
  ) {}

  async forgot(input: ForgotPasswordRequest, meta: ClientMeta): Promise<void> {
    const wait = await this.limiter.hit(`forgot:${meta.ip ?? 'unknown'}`);
    if (wait > 0) throw new TooManyAttemptsError(wait);
    const user = await this.users.findByEmail(input.email);
    if (!user) return;
    try {
      const { email, name } = user.snapshot();
      await this.codes.send({ email, name }, 'reset_password');
    } catch (e) {
      // Within the cooldown the earlier code still works; answering differently would tell
      // that the address has an account.
      if (!(e instanceof TooManyAttemptsError)) throw e;
    }
  }

  async reset(input: ResetPasswordRequest, meta: ClientMeta): Promise<void> {
    const key = `reset:${meta.ip ?? 'unknown'}:${input.email}`;
    const wait = await this.limiter.hit(key);
    if (wait > 0) throw new TooManyAttemptsError(wait);
    const user = await this.users.findByEmail(input.email);
    if (!user) throw new EmailCodeError('code_invalid');
    const s = user.snapshot();
    assertPasswordAcceptable(input.password, { email: s.email, name: s.name });
    await this.codes.consume(input.email, 'reset_password', input.code);
    await this.users.setPassword(user.id, await this.hasher.hash(input.password), new Date());
    await this.sessions.revokeAll(user.id);
    await this.limiter.reset(key);
  }
}

@Injectable()
export class LoginHandler {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(ATTEMPT_LIMITER) private readonly limiter: AttemptLimiter,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(MfaService) private readonly mfa: MfaService,
  ) {}

  async execute(input: LoginRequest, meta: ClientMeta): Promise<IssuedSession> {
    const key = `login:${meta.ip ?? 'unknown'}:${input.email}`;
    const wait = await this.limiter.hit(key);
    if (wait > 0) throw new TooManyAttemptsError(wait);
    const user = await this.users.findByEmail(input.email);
    // A Google-only user has no password yet: same answer and cost as an unknown email.
    if (!user?.hasPassword) {
      await this.hasher.dummyVerify(input.password);
      throw new InvalidCredentialsError();
    }
    if (!(await this.hasher.verify(user.passwordHash, input.password))) {
      throw new InvalidCredentialsError();
    }
    // The attempt stays counted until the second factor passes too, so codes cannot be guessed freely.
    if (await this.mfa.isEnabled(user.id)) {
      if (!input.code) throw new MfaRequiredError();
      if (!(await this.mfa.verifyLogin(user.id, input.code))) throw new MfaCodeInvalidError();
    }
    await this.limiter.reset(key);
    return this.sessions.start(user, meta);
  }
}

@Injectable()
export class RefreshHandler {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  async execute(rawToken: string | undefined, meta: ClientMeta): Promise<IssuedSession> {
    if (!rawToken) throw new SessionInvalidError('missing');
    const { userId, familyId } = await this.sessions.consume(rawToken);
    const user = await this.users.findById(userId);
    if (!user) throw new SessionInvalidError('user_gone');
    return this.sessions.start(user, meta, familyId);
  }
}

@Injectable()
export class AccountQueries implements IdentityFacade, IdentityAdminFacade {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
    @Inject(ACCOUNT_FACADE) private readonly accounts: AccountFacade,
  ) {}

  async me(userId: UserId): Promise<UserDto> {
    const user = await this.users.findById(userId);
    if (!user) throw new SessionInvalidError('user_gone');
    return toUserDto(user);
  }

  async displayName(userId: UserId): Promise<string | null> {
    return (await this.users.findById(userId))?.snapshot().name ?? null;
  }

  async profile(
    userId: UserId,
  ): Promise<{ name: string; email: string; locale: 'vi' | 'en' } | null> {
    const user = (await this.users.findById(userId))?.snapshot();
    return user
      ? { name: user.name, email: user.email, locale: user.locale === 'en' ? 'en' : 'vi' }
      : null;
  }

  async usersByIds(ids: readonly string[]): Promise<UserRef[]> {
    return (await this.users.findByIds(ids.map((id) => id as UserId))).map(toUserRef);
  }

  async searchUsers(q: string, limit: number): Promise<UserRef[]> {
    return (await this.users.search(q, limit)).map(toUserRef);
  }

  /** Read on every admin request (not from the token) so revoking takes effect immediately. */
  async isPlatformAdmin(userId: UserId): Promise<boolean> {
    return (await this.users.findById(userId))?.isPlatformAdmin ?? false;
  }

  async bootstrap(userId: UserId): Promise<BootstrapResponse> {
    const [user, memberships, accounts] = await Promise.all([
      this.me(userId),
      this.workspaces.listMemberships(userId),
      this.accounts.listForUser(userId),
    ]);
    // Only accounts owning a business the user is a member of are named (switcher grouping).
    const names = await this.accounts.namesOf(
      memberships.flatMap((m) => (m.accountId ? [m.accountId] : [])),
    );
    return {
      user,
      accounts,
      memberships: memberships.map((m) => ({
        ...m,
        createdAt: m.createdAt.toISOString(),
        accountName: m.accountId ? (names.get(m.accountId) ?? null) : null,
      })),
    };
  }
}

function toUserRef(user: User): UserRef {
  const s = user.snapshot();
  return { id: s.id, name: s.name, email: s.email, phone: s.phone };
}
