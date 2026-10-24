import type {
  BootstrapResponse,
  LoginRequest,
  SignupRequest,
  UserDto,
} from '@agent-sales/contracts';
import type { UserId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../../workspace/api/index.js';
import {
  EmailTakenError,
  InvalidCredentialsError,
  SessionInvalidError,
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
import type { IdentityFacade } from '../../api/identity.facade.js';
import { type ClientMeta, type IssuedSession, SessionService, toUserDto } from '../sessions.js';

/**
 * Signup: user (system role) → first workspace with the user as owner
 * (workspace facade, tenant transaction) → session. The two writes are in
 * different transactions on purpose (identity is cross-tenant); if the
 * workspace step fails the user can log in and create one from /bootstrap.
 */
@Injectable()
export class SignupHandler {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(ATTEMPT_LIMITER) private readonly limiter: AttemptLimiter,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  async execute(input: SignupRequest, meta: ClientMeta): Promise<IssuedSession> {
    const wait = await this.limiter.hit(`signup:${meta.ip ?? 'unknown'}`);
    if (wait > 0) throw new TooManyAttemptsError(wait);
    assertPasswordAcceptable(input.password, { email: input.email, name: input.name });
    if (await this.users.findByEmail(input.email)) throw new EmailTakenError();
    const user = User.register({
      email: input.email,
      name: input.name,
      phone: input.phone,
      passwordHash: await this.hasher.hash(input.password),
    });
    await this.users.insert(user);
    await this.workspaces.createWorkspace({
      name: input.workspaceName,
      industry: input.industry,
      ownerUserId: user.id,
    });
    return this.sessions.start(user, meta);
  }
}

@Injectable()
export class LoginHandler {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(ATTEMPT_LIMITER) private readonly limiter: AttemptLimiter,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  async execute(input: LoginRequest, meta: ClientMeta): Promise<IssuedSession> {
    const key = `login:${meta.ip ?? 'unknown'}:${input.email}`;
    const wait = await this.limiter.hit(key);
    if (wait > 0) throw new TooManyAttemptsError(wait);
    const user = await this.users.findByEmail(input.email);
    if (!user) {
      await this.hasher.dummyVerify(input.password);
      throw new InvalidCredentialsError();
    }
    if (!(await this.hasher.verify(user.passwordHash, input.password))) {
      throw new InvalidCredentialsError();
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
export class AccountQueries implements IdentityFacade {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
  ) {}

  async me(userId: UserId): Promise<UserDto> {
    const user = await this.users.findById(userId);
    if (!user) throw new SessionInvalidError('user_gone');
    return toUserDto(user);
  }

  async displayName(userId: UserId): Promise<string | null> {
    return (await this.users.findById(userId))?.snapshot().name ?? null;
  }

  async profile(userId: UserId): Promise<{ name: string; email: string } | null> {
    const user = (await this.users.findById(userId))?.snapshot();
    return user ? { name: user.name, email: user.email } : null;
  }

  /** Read on every admin request (not from the token) so revoking takes effect immediately. */
  async isPlatformAdmin(userId: UserId): Promise<boolean> {
    return (await this.users.findById(userId))?.isPlatformAdmin ?? false;
  }

  async bootstrap(userId: UserId): Promise<BootstrapResponse> {
    const [user, memberships] = await Promise.all([
      this.me(userId),
      this.workspaces.listMemberships(userId),
    ]);
    return { user, memberships };
  }
}
