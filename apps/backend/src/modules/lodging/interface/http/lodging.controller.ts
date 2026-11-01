import { Controller, Inject } from '@nestjs/common';

import { LODGING_FACADE, type LodgingFacade } from '../../api/lodging.facade.js';

/** Thin controller: Zod-validate (packages/contracts) → facade → DTO. */
@Controller('lodging')
export class LodgingController {
  constructor(@Inject(LODGING_FACADE) private readonly facade: LodgingFacade) {}
}
