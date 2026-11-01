import { Injectable } from '@nestjs/common';

import type { IntegrationFacade } from '../api/integration.facade.js';

/** Delegates to command/query handlers; no logic of its own. */
@Injectable()
export class IntegrationFacadeImpl implements IntegrationFacade {}
