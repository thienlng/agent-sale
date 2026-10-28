import { Controller, Inject } from '@nestjs/common';

import { ACCOUNT_FACADE, type AccountFacade } from '../../api/account.facade.js';

/** Thin controller: Zod-validate (packages/contracts) → facade → DTO. */
@Controller('account')
export class AccountController {
  constructor(@Inject(ACCOUNT_FACADE) private readonly facade: AccountFacade) {}
}
