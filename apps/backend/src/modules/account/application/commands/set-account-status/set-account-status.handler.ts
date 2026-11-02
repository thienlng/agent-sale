import { Inject, Injectable } from '@nestjs/common';

import { type AccountStatus, assertStatusChange } from '../../../domain/account.js';
import {
  ACCOUNT_REPOSITORY,
  type AccountRepository,
  type OperatorAction,
} from '../../../domain/ports/account.repository.js';

/**
 * Platform operator suspends or reactivates an account (ADR-021 §6). The bot of a suspended
 * account stops replying (billing reads the status); dashboards stay readable.
 */
@Injectable()
export class SetAccountStatusHandler {
  constructor(@Inject(ACCOUNT_REPOSITORY) private readonly accounts: AccountRepository) {}

  async execute(accountId: string, status: AccountStatus, action: OperatorAction): Promise<void> {
    await this.accounts.setStatus(
      accountId,
      status,
      action,
      (from) => assertStatusChange(from, status),
      new Date(),
    );
  }
}
