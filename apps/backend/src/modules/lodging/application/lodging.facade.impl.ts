import { Injectable } from '@nestjs/common';

import type { LodgingFacade } from '../api/lodging.facade.js';

/** Delegates to command/query handlers; no logic of its own. */
@Injectable()
export class LodgingFacadeImpl implements LodgingFacade {}
