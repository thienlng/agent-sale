import { createHash, randomInt } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { type EmailMessage, MAILER, type Mailer } from '../../../common/email/mailer.js';
import { EmailCodeError, TooManyAttemptsError } from '../domain/identity.errors.js';
import {
  EMAIL_CODE_REPOSITORY,
  type EmailCodePurpose,
  type EmailCodeRepository,
} from '../domain/ports/email-code.repository.js';
import { AUTH_LIMITS, overLimit } from './auth-limits.js';
import { accountExistsEmail, codeEmail, codeGuessAlertEmail } from './email-templates.js';
import { AUTH_COUNTER, type WindowCounter } from './ports/security.js';

export const CODE_TTL_MINUTES = 15;
/** A new code for the same address and purpose waits this long after the previous one. */
export const RESEND_COOLDOWN_SECONDS = 60;
/**
 * Wrong guesses a code survives; the next one kills it. A new code starts again at 0, so the
 * per-day cap on checks (`AUTH_LIMITS.codeChecksPerDay`) is what bounds guessing across resends.
 */
export const MAX_CODE_ATTEMPTS = 5;

function hashCode(email: string, purpose: EmailCodePurpose, code: string): string {
  return createHash('sha256').update(`${email}:${purpose}:${code}`).digest('hex');
}

const normalize = (email: string): string => email.trim().toLowerCase();

/**
 * Emailed 6-digit one-time codes (ACC-01): one live code per address and purpose. Every email to
 * an address counts against `AUTH_LIMITS.emailsPerHour` / `emailsPerDay` on the shared counter.
 */
@Injectable()
export class EmailCodeService {
  readonly #log = new Logger(EmailCodeService.name);

  constructor(
    @Inject(EMAIL_CODE_REPOSITORY) private readonly codes: EmailCodeRepository,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(AUTH_COUNTER) private readonly counter: WindowCounter,
  ) {}

  /**
   * Emails a new code, replacing the previous one. Within the cooldown or over the address's email
   * caps nothing is sent and `TooManyAttemptsError` says how long to wait. `name` greets the reader
   * when known; pass only a name the account already has, never one typed by an anonymous caller.
   */
  async send(
    to: { email: string; name?: string | null | undefined },
    purpose: EmailCodePurpose,
    now = new Date(),
  ): Promise<void> {
    const name = to.name ?? null;
    await this.#issue(to.email, purpose, now, (email, code) =>
      codeEmail({ to: email, name, purpose, code, minutes: CODE_TTL_MINUTES }),
    );
  }

  /**
   * Instead of a signup code, for an address that already has an account: a "sign in or reset your
   * password" notice. It goes through the same steps as a code (cooldown, caps, a stored code that
   * is never sent), so neither this answer nor later wrong guesses tell that the account exists.
   */
  async sendAccountExists(address: string, now = new Date()): Promise<void> {
    await this.#issue(address, 'signup', now, (email) => accountExistsEmail({ to: email }));
  }

  /**
   * Checks and uses up the code; throws `EmailCodeError` when it is wrong, used up or expired, and
   * `TooManyAttemptsError` once the address had `AUTH_LIMITS.codeChecksPerDay` checks (the right
   * code included). The first refusal of a password reset warns the account owner by email.
   */
  async consume(
    address: string,
    purpose: EmailCodePurpose,
    code: string,
    now = new Date(),
  ): Promise<void> {
    const email = normalize(address);
    const row = await this.codes.find(email, purpose);
    if (!row) throw new EmailCodeError('code_invalid');
    const { max, windowMs } = AUTH_LIMITS.codeChecksPerDay;
    const checks = await this.counter.hit(`code-check:${purpose}:${email}`, windowMs);
    if (checks.count > max) {
      if (checks.count === max + 1 && purpose === 'reset_password') await this.#alert(email);
      throw new TooManyAttemptsError(Math.max(1, checks.retryAfterSeconds));
    }
    if (row.expiresAt <= now || row.attempts >= MAX_CODE_ATTEMPTS) {
      throw new EmailCodeError('code_expired');
    }
    if (row.codeHash !== hashCode(email, purpose, code)) {
      await this.codes.addAttempt(email, purpose);
      throw new EmailCodeError('code_invalid');
    }
    await this.codes.delete(email, purpose);
  }

  async #issue(
    address: string,
    purpose: EmailCodePurpose,
    now: Date,
    message: (email: string, code: string) => EmailMessage,
  ): Promise<void> {
    const email = normalize(address);
    const previous = await this.codes.find(email, purpose);
    if (previous) {
      const wait = Math.ceil(
        (previous.sentAt.getTime() + RESEND_COOLDOWN_SECONDS * 1000 - now.getTime()) / 1000,
      );
      if (wait > 0) throw new TooManyAttemptsError(wait);
    }
    await this.#reserveEmail(email);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.codes.put({
      email,
      purpose,
      codeHash: hashCode(email, purpose, code),
      attempts: 0,
      sentAt: now,
      expiresAt: new Date(now.getTime() + CODE_TTL_MINUTES * 60_000),
    });
    await this.mailer.send(message(email, code));
  }

  async #reserveEmail(email: string): Promise<void> {
    for (const [window, limit] of [
      ['h', AUTH_LIMITS.emailsPerHour],
      ['d', AUTH_LIMITS.emailsPerDay],
    ] as const) {
      const wait = await overLimit(this.counter, `email-send:${window}:${email}`, limit);
      if (wait > 0) throw new TooManyAttemptsError(wait);
    }
  }

  /** Best effort: a failed warning must not change the answer the guesser gets. */
  async #alert(email: string): Promise<void> {
    try {
      await this.mailer.send(codeGuessAlertEmail({ to: email }));
    } catch (e) {
      this.#log.warn(`Code-guess warning email failed: ${(e as Error).name}`);
    }
  }
}
