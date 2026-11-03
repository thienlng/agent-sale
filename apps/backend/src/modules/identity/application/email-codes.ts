import { createHash, randomInt } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { MAILER, type Mailer } from '../../../common/email/mailer.js';
import { EmailCodeError, TooManyAttemptsError } from '../domain/identity.errors.js';
import {
  EMAIL_CODE_REPOSITORY,
  type EmailCodePurpose,
  type EmailCodeRepository,
} from '../domain/ports/email-code.repository.js';
import { codeEmail } from './email-templates.js';

export const CODE_TTL_MINUTES = 15;
/** A new code for the same address and purpose waits this long after the previous one. */
export const RESEND_COOLDOWN_SECONDS = 60;
/** Wrong guesses a code survives; the next one kills it. */
export const MAX_CODE_ATTEMPTS = 5;

function hashCode(email: string, purpose: EmailCodePurpose, code: string): string {
  return createHash('sha256').update(`${email}:${purpose}:${code}`).digest('hex');
}

const normalize = (email: string): string => email.trim().toLowerCase();

/** Emailed 6-digit one-time codes (ACC-01): one live code per address and purpose. */
@Injectable()
export class EmailCodeService {
  constructor(
    @Inject(EMAIL_CODE_REPOSITORY) private readonly codes: EmailCodeRepository,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  /**
   * Emails a new code, replacing the previous one. Within the cooldown nothing is sent and
   * `TooManyAttemptsError` says how long to wait. `name` greets the reader when known.
   */
  async send(
    to: { email: string; name?: string | null | undefined },
    purpose: EmailCodePurpose,
    now = new Date(),
  ): Promise<void> {
    const email = normalize(to.email);
    const previous = await this.codes.find(email, purpose);
    if (previous) {
      const wait = Math.ceil(
        (previous.sentAt.getTime() + RESEND_COOLDOWN_SECONDS * 1000 - now.getTime()) / 1000,
      );
      if (wait > 0) throw new TooManyAttemptsError(wait);
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.codes.put({
      email,
      purpose,
      codeHash: hashCode(email, purpose, code),
      attempts: 0,
      sentAt: now,
      expiresAt: new Date(now.getTime() + CODE_TTL_MINUTES * 60_000),
    });
    await this.mailer.send(
      codeEmail({ to: email, name: to.name ?? null, purpose, code, minutes: CODE_TTL_MINUTES }),
    );
  }

  /** Checks and uses up the code; throws `EmailCodeError` when it is wrong, used up or expired. */
  async consume(
    address: string,
    purpose: EmailCodePurpose,
    code: string,
    now = new Date(),
  ): Promise<void> {
    const email = normalize(address);
    const row = await this.codes.find(email, purpose);
    if (!row) throw new EmailCodeError('code_invalid');
    if (row.expiresAt <= now || row.attempts >= MAX_CODE_ATTEMPTS) {
      throw new EmailCodeError('code_expired');
    }
    if (row.codeHash !== hashCode(email, purpose, code)) {
      await this.codes.addAttempt(email, purpose);
      throw new EmailCodeError('code_invalid');
    }
    await this.codes.delete(email, purpose);
  }
}
