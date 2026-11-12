import type { StepUpMethod, StepUpRequest, StepUpStatus } from '@agent-sales/contracts';
import type { UserId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { MfaReauthError, SessionInvalidError } from '../domain/identity.errors.js';
import {
  EXTERNAL_IDENTITY_REPOSITORY,
  type ExternalIdentityRepository,
} from '../domain/ports/external-identity.repository.js';
import { USER_REPOSITORY, type UserRepository } from '../domain/ports/user.repository.js';
import { EmailCodeService } from './email-codes.js';
import { MfaService } from './mfa.service.js';
import { SecurityEventService } from './security-events.js';
import { SessionService } from './sessions.js';

/**
 * Step-up re-authentication of the current session (docs/09 §2): sensitive actions (API key
 * creation, data export, linked sign-in removal, platform payment and plan changes) need the user
 * to have proved a factor within `AUTH_STEP_UP_WINDOW_MINUTES`. Which proof:
 *
 * - two-factor on → an authenticator or recovery code (it also marks the session two-factor);
 * - else a password → the password;
 * - else (Google sign-in only) → a code emailed to the account address, or a new Google sign-in
 *   (which opens a fresh session).
 */
@Injectable()
export class StepUpService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(EXTERNAL_IDENTITY_REPOSITORY) private readonly identities: ExternalIdentityRepository,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(MfaService) private readonly mfa: MfaService,
    @Inject(EmailCodeService) private readonly codes: EmailCodeService,
    @Inject(SecurityEventService) private readonly events: SecurityEventService,
  ) {}

  async status(userId: UserId, sessionId: string, now = Date.now()): Promise<StepUpStatus> {
    const state = await this.sessions.state(sessionId, true, now);
    const recent = state !== null && state.userId === userId && this.sessions.isRecent(state, now);
    const at = state?.authenticatedAt?.getTime();
    const user = await this.#user(userId);
    return {
      methods: await this.#methods(userId),
      hasPassword: user.hasPassword,
      recent,
      mfa: state?.mfa ?? false,
      recentUntil:
        recent && at !== undefined
          ? new Date(at + this.sessions.stepUpWindowSeconds * 1000).toISOString()
          : null,
    };
  }

  /** Emails a step-up code to a user who has neither two-factor nor a password. */
  async sendCode(userId: UserId): Promise<void> {
    const user = await this.#user(userId);
    if (!(await this.#methods(userId)).includes('email')) throw new MfaReauthError('invalid_code');
    const { email, name } = user.snapshot();
    await this.codes.send({ email, name }, 'reauth');
  }

  async verify(
    userId: UserId,
    sessionId: string,
    input: StepUpRequest,
    ip: string | null,
  ): Promise<StepUpStatus> {
    const user = await this.#user(userId);
    let method: StepUpMethod;
    if (await this.mfa.isEnabled(userId)) {
      await this.mfa.verifyStepUp(userId, input.code);
      method = 'totp';
    } else if (user.hasPassword) {
      await this.mfa.verifyPassword(userId, input.password);
      method = 'password';
    } else {
      if (!input.emailCode) throw new MfaReauthError('invalid_code');
      await this.codes.consume(user.snapshot().email, 'reauth', input.emailCode);
      method = 'email';
    }
    // The only place that records an explicit step-up (`steppedUpAt`): a sign-in never does.
    await this.sessions.markAuthenticated(userId, sessionId, {
      mfa: method === 'totp',
      steppedUp: true,
    });
    await this.events.record(userId, 'session.step_up', { method }, ip);
    return this.status(userId, sessionId);
  }

  async #methods(userId: UserId): Promise<StepUpMethod[]> {
    if (await this.mfa.isEnabled(userId)) return ['totp'];
    const user = await this.#user(userId);
    if (user.hasPassword) return ['password'];
    const linked = (await this.identities.listForUser(userId)).length > 0;
    return linked ? ['email', 'google'] : ['email'];
  }

  async #user(userId: UserId) {
    const user = await this.users.findById(userId);
    if (!user) throw new SessionInvalidError('user_gone');
    return user;
  }
}
