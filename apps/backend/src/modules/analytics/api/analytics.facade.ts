import type { DefinitionsResponse } from '@agent-sales/contracts';

/** PUBLIC CONTRACT of the analytics module. Use-case shaped, returns DTOs from packages/contracts. */
export interface AnalyticsFacade {
  /** What every statistics metric means, with the definition version reports quote. */
  definitions(): DefinitionsResponse;
}

export const ANALYTICS_FACADE = Symbol('ANALYTICS_FACADE');
