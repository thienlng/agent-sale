import { Controller, Inject } from '@nestjs/common';

import { INTEGRATION_FACADE, type IntegrationFacade } from '../../api/integration.facade.js';

/** Thin controller: Zod-validate (packages/contracts) → facade → DTO. */
@Controller('integration')
export class IntegrationController {
  constructor(@Inject(INTEGRATION_FACADE) private readonly facade: IntegrationFacade) {}
}
