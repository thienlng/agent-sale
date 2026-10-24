import type { MfaStatus } from '@agent-sales/contracts';
import type { UserId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { SECRET_BOX, type SecretBox } from '../../../common/security/secret-box.js';
import {
  MfaReauthError,
  MfaStateError,
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
 * enough to disable it). Codes are single use (lastUsedStep), recovery codes
 * are hashed and burn on use.
 */
@Injectable()
export class MfaService {
  constructor(
    @Inject(MFA_REPOSITORY) private readonly repo: MfaRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(ATTEMPT_LIMITER) private readonly limiter: AttemptLimiter,
    @Inject(SECRET_BOX) private readonly secrets: SecretBox,
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
    password: string,
  ): Promise<{ secret: string; otpauthUri: string }> {
    const user = await this.reauth(userId, password);
    const secret = newTotpSecret();
    if (!(await this.repo.savePending(userId, this.secrets.seal(secret)))) {
      throw new MfaStateError('already_enabled');
    }
    return { secret, otpauthUri: otpauthUri(secret, user.snapshot().email, ISSUER) };
  }

  /** Confirms the first code; returns the recovery codes, shown once. */
  async enable(userId: UserId, code: string): Promise<string[]> {
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
    return codes;
  }

  async disable(userId: UserId, password: string, code: string): Promise<void> {
    await this.reauth(userId, password);
    await this.requireValidCode(userId, code);
    await this.repo.remove(userId);
  }

  async regenerateRecoveryCodes(userId: UserId, password: string, code: string): Promise<string[]> {
    await this.reauth(userId, password);
    await this.requireValidCode(userId, code);
    const codes = newRecoveryCodes();
    await this.repo.replaceRecovery(userId, codes.map(hashRecoveryCode));
    return codes;
  }

  /** Login second step: an authenticator code or a recovery code. */
  async verifyLogin(userId: UserId, code: string): Promise<boolean> {
    const row = await this.repo.find(userId);
    if (!row?.enabledAt) return true;
    // Per user, not per address: rotating IPs must not give a fresh budget of code guesses.
    await this.throttle(userId);
    if (!(await this.accepts(row, code))) return false;
    await this.limiter.reset(`mfa:${userId}`);
    return true;
  }

  /** Operator reset (lost phone and recovery codes). */
  reset(userId: UserId): Promise<boolean> {
    return this.repo.remove(userId);
  }

  private async requireValidCode(userId: UserId, code: string): Promise<void> {
    const row = await this.repo.find(userId);
    if (!row?.enabledAt) throw new MfaStateError('not_enabled');
    await this.throttle(userId);
    if (!(await this.accepts(row, code))) throw new MfaReauthError('invalid_code');
    await this.limiter.reset(`mfa:${userId}`);
  }

  private async accepts(row: MfaRecord, code: string): Promise<boolean> {
    const step = verifyTotp(
      this.secrets.open(row.secretSealed),
      code,
      row.lastUsedStep,
      Date.now(),
    );
    if (step !== null) return this.repo.advanceStep(row.userId, step);
    if (/^\d{6}$/.test(code)) return false;
    return this.repo.consumeRecovery(row.userId, hashRecoveryCode(code));
  }

  private async reauth(userId: UserId, password: string) {
    await this.throttle(userId);
    const user = await this.users.findById(userId);
    if (!user) throw new SessionInvalidError('user_gone');
    if (!(await this.hasher.verify(user.passwordHash, password))) {
      throw new MfaReauthError('invalid_password');
    }
    return user;
  }

  private async throttle(userId: UserId): Promise<void> {
    const wait = await this.limiter.hit(`mfa:${userId}`);
    if (wait > 0) throw new TooManyAttemptsError(wait);
  }
}
