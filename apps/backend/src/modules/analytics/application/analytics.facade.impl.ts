import { ANALYTICS_DEFINITION_VERSION, METRIC_DEFINITIONS } from '@agent-sales/contracts';
import { Injectable } from '@nestjs/common';

import type { AnalyticsFacade } from '../api/analytics.facade.js';

/** Delegates to command/query handlers; no logic of its own. */
@Injectable()
export class AnalyticsFacadeImpl implements AnalyticsFacade {
  definitions() {
    return { version: ANALYTICS_DEFINITION_VERSION, definitions: [...METRIC_DEFINITIONS] };
  }
}
