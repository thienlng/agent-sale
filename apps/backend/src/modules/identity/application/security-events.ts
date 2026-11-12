import { newId, type UserId } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { MAILER, type Mailer } from '../../../common/email/mailer.js';
import {
  SECURITY_EVENT_REPOSITORY,
  type SecurityAction,
  type SecurityEventRepository,
} from '../domain/ports/security-event.repository.js';
import { USER_REPOSITORY, type UserRepository } from '../domain/ports/user.repository.js';
import { type SecurityNotice, securityNoticeEmail } from './email-templates.js';

/** A log-safe tag of an unexpected error: class name only (Rule 07: no PII in logs). */
function errorName(e: unknown): string {
  return e instanceof Error && /^\w{1,60}$/.test(e.name) ? e.name : 'unknown';
}

/**
 * The user's security log (`user_security_events`) and the "was this you?" emails. Both run after
 * the change they describe has been made, so a failure is logged and never undoes or fails it.
 */
@Injectable()
export class SecurityEventService {
  readonly #log = new Logger(SecurityEventService.name);

  constructor(
    @Inject(SECURITY_EVENT_REPOSITORY) private readonly events: SecurityEventRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  /** `data` holds ids, method names and counts only: never codes, tokens or passwords. */
  async record(
    userId: UserId,
    action: SecurityAction,
    data: Record<string, unknown> = {},
    ip: string | null = null,
  ): Promise<void> {
    try {
      await this.events.append({
        id: newId(),
        userId,
        action,
        data,
        ip,
        createdAt: new Date(),
      });
    } catch (e) {
      this.#log.error(`Security event ${action} not recorded: ${errorName(e)}`);
    }
  }

  /** Emails the account owner about a change of their account. */
  async notify(userId: UserId, notice: SecurityNotice): Promise<void> {
    try {
      const user = (await this.users.findById(userId))?.snapshot();
      if (!user) return;
      await this.mailer.send(securityNoticeEmail({ to: user.email, name: user.name, notice }));
    } catch (e) {
      this.#log.warn(`Security notice ${notice} not sent: ${errorName(e)}`);
    }
  }
}
