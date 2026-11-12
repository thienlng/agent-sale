import type { MfaStatus } from '@agent-sales/contracts';
import type { UserId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { SECRET_BOX, type SecretBox } from '../../../common/security/secret-box.js';
import {
  MfaReauthError,
  MfaStateError,
  ReauthRequiredError,
  SessionInvalidError,
  TooManyAttemptsError,
} from '../domain/identity.errors.js';
import {
  MFA_REPOSITORY,
  type MfaRecord,
  type MfaRepository,
} from '../domain/ports/mfa.repository.js';
import { USER_REPOSITORY, type UserRepository } from '../domain/ports/user.repository.js';
import {
  hashRecoveryCode,
  newRecoveryCodes,
  newTotpSecret,
  otpauthUri,
  verifyTotp,
} from '../domain/totp.js';
import { SecurityEventService } from './security-events.js';
import { SessionService } from './sessions.js';
import {
  ATTEMPT_LIMITER,
  type AttemptLimiter,
  PASSWORD_HASHER,
  type PasswordHasher,
} from './ports/security.js';

const ISSUER = 'Rapiz';

/**
 * TOTP second factor (ADM-04). Turning it on needs a confirmed first code;
 * changing it needs the password again (a stolen access token must not be
 * enough to disable it); a user without a password (Google sign-in only) needs a
 * recent step-up of the session instead (emailed code or a new Google sign-in).
 * Codes are single use (lastUsedStep), recovery codes are hashed and burn on use.
 * Every change signs out the user's other sessions (turning 2FA on after a suspected
 * compromise must also end the intruder's session), is logged in the user's security
 * log and emailed to them.
 */
@Injectable()
export class MfaService {
  constructor(
    @Inject(MFA_REPOSITORY) private readonly repo: MfaRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(ATTEMPT_LIMITER) private readonly limiter: AttemptLimiter,
    @Inject(SECRET_BOX) private readonly secrets: SecretBox,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(SecurityEventService) private readonly events: SecurityEventService,
  ) {}

  async status(userId: UserId): Promise<MfaStatus> {
    const row = await this.repo.find(userId);
    return row?.enabledAt
      ? { enabled: true, recoveryCodesLeft: row.recoveryHashes.length }
      : { enabled: false, recoveryCodesLeft: 0 };
  }

  async isEnabled(userId: UserId): Promise<boolean> {
    return Boolean((await this.repo.find(userId))?.enabledAt);
  }

  async beginSetup(
    userId: UserId,
    password: string | undefined,
    sessionId: string,
  ): Promise<{ secret: string; otpauthUri: string }> {
    const user = await this.reauth(userId, password, sessionId);
    const secret = newTotpSecret();
    if (!(await this.repo.savePending(userId, this.secrets.seal(secret)))) {
      throw new MfaStateError('already_enabled');
    }
    return { secret, otpauthUri: otpauthUri(secret, user.snapshot().email, ISSUER) };
  }

  /** Confirms the first code; returns the recovery codes, shown once. */
  async enable(userId: UserId, code: string, sessionId: string): Promise<string[]> {
    await this.throttle(userId);
    const row = await this.repo.find(userId);
    if (!row) throw new MfaStateError('no_setup');
    if (row.enabledAt) throw new MfaStateError('already_enabled');
    const step = verifyTotp(this.secrets.open(row.secretSealed), code, 0, Date.now());
    if (step === null) throw new MfaReauthError('invalid_code');
    const codes = newRecoveryCodes();
    if (!(await this.repo.enable(userId, step, codes.map(hashRecoveryCode)))) {
      throw new MfaStateError('already_enabled');
    }
    await this.limiter.reset(`mfa:${userId}`);
    await this.sessions.revokeOthers(userId, sessionId);
    // The code just proved the second factor on this session.
    await this.sessions.markAuthenticated(userId, sessionId, true);
    await this.events.record(userId, 'mfa.enabled');
    await this.events.notify(userId, 'mfa_enabled');
    return codes;
  }

  async disable(
    userId: UserId,
    password: string | undefined,
    code: string,
    sessionId: string,
  ): Promise<void> {
    await this.reauth(userId, password, sessionId);
    await this.requireValidCode(userId, code);
    await this.repo.remove(userId);
    await this.sessions.revokeOthers(userId, sessionId);
    await this.events.record(userId, 'mfa.disabled');
    await this.events.notify(userId, 'mfa_disabled');
  }

  async regenerateRecoveryCodes(
    userId: UserId,
    password: string | undefined,
    code: string,
    sessionId: string,
  ): Promise<string[]> {
    await this.reauth(userId, password, sessionId);
    await this.requireValidCode(userId, code);
    const codes = newRecoveryCodes();
    await this.repo.replaceRecovery(userId, codes.map(hashRecoveryCode));
    await this.sessions.revokeOthers(userId, sessionId);
    await this.events.record(userId, 'mfa.recovery_codes_replaced');
    await this.events.notify(userId, 'recovery_codes');
    return codes;
  }

  /** Login second step: an authenticator code or a recovery code. */
  async verifyLogin(userId: UserId, code: string): Promise<boolean> {
    const row = await this.repo.find(userId);
    if (!row?.enabledAt) return true;
    // Per user, not per address: rotating IPs must not give a fresh budget of code guesses.
    await this.throttle(userId);
    const used = await this.accepts(row, code);
    if (!used) return false;
    await this.limiter.reset(`mfa:${userId}`);
    if (used === 'recovery') await this.events.record(userId, 'mfa.recovery_code_used');
    return true;
  }

  /**
   * Step-up of a user with two-factor on: an authenticator or recovery code, throttled like login.
   * Throws `MfaReauthError('invalid_code')` when it does not check out.
   */
  async verifyStepUp(userId: UserId, code: string | undefined): Promise<void> {
    if (!code) throw new MfaReauthError('invalid_code');
    await this.requireValidCode(userId, code);
  }

  /**
   * Checks the password for a step-up (throttled). A user without a password never passes here:
   * they step up with an emailed code or a Google sign-in.
   */
  async verifyPassword(userId: UserId, password: string | undefined): Promise<void> {
    await this.throttle(userId);
    const user = await this.users.findById(userId);
    if (!user) throw new SessionInvalidError('user_gone');
    if (!password || !user.hasPassword || !(await this.hasher.verify(user.passwordHash, password)))
      throw new MfaReauthError('invalid_password');
    await this.limiter.reset(`mfa:${userId}`);
  }

  /** Operator reset (lost phone and recovery codes). */
  reset(userId: UserId): Promise<boolean> {
    return this.repo.remove(userId);
  }

  private async requireValidCode(userId: UserId, code: string): Promise<void> {
    const row = await this.repo.find(userId);
    if (!row?.enabledAt) throw new MfaStateError('not_enabled');
    await this.throttle(userId);
    const used = await this.accepts(row, code);
    if (!used) throw new MfaReauthError('invalid_code');
    await this.limiter.reset(`mfa:${userId}`);
    if (used === 'recovery') await this.events.record(userId, 'mfa.recovery_code_used');
  }

  /** Which kind of code checked out (and was used up), or null. */
  private async accepts(row: MfaRecord, code: string): Promise<'totp' | 'recovery' | null> {
    const step = verifyTotp(
      this.secrets.open(row.secretSealed),
      code,
      row.lastUsedStep,
      Date.now(),
    );
    if (step !== null) return (await this.repo.advanceStep(row.userId, step)) ? 'totp' : null;
    if (/^\d{6}$/.test(code)) return null;
    return (await this.repo.consumeRecovery(row.userId, hashRecoveryCode(code)))
      ? 'recovery'
      : null;
  }

  /**
   * The password again; a user without one (Google sign-in only) has no password to give, so their
   * session must have stepped up recently instead (`ReauthRequiredError` otherwise).
   */
  private async reauth(userId: UserId, password: string | undefined, sessionId: string) {
    await this.throttle(userId);
    const user = await this.users.findById(userId);
    if (!user) throw new SessionInvalidError('user_gone');
    if (!user.hasPassword) {
      const state = await this.sessions.state(sessionId, true);
      if (!state || state.userId !== userId || !this.sessions.isRecent(state))
        throw new ReauthRequiredError();
      return user;
    }
    if (!password || !(await this.hasher.verify(user.passwordHash, password))) {
      throw new MfaReauthError('invalid_password');
    }
    return user;
  }

  private async throttle(userId: UserId): Promise<void> {
    const wait = await this.limiter.hit(`mfa:${userId}`);
    if (wait > 0) throw new TooManyAttemptsError(wait);
  }
}
