import type { UserId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import type { AccountFacade } from '../api/account.facade.js';
import { ResolveBusinessAccountHandler } from './commands/resolve-business-account/resolve-business-account.handler.js';

/** Delegates to command/query handlers; no logic of its own. */
@Injectable()
export class AccountFacadeImpl implements AccountFacade {
  constructor(
    @Inject(ResolveBusinessAccountHandler) private readonly resolve: ResolveBusinessAccountHandler,
  ) {}

  resolveForNewBusiness(input: {
    userId: UserId;
    accountId?: string | undefined;
    businessName: string;
  }): Promise<string> {
    return this.resolve.execute(input);
  }
}
