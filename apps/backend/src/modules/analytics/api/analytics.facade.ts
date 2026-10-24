import type { DefinitionsResponse } from '@agent-sales/contracts';

/** PUBLIC CONTRACT of the analytics module. Use-case shaped, returns DTOs from packages/contracts. */
export interface AnalyticsFacade {
  /** What every statistics metric means, with the definition version reports quote. */
  definitions(): DefinitionsResponse;
}

export const ANALYTICS_FACADE = Symbol('ANALYTICS_FACADE');

/** Background projection of the outbox into statistics facts; run by the `worker` entry. */
export interface AnalyticsRunner {
  /** Consumes one batch of pending events; resolves to how many it consumed. */
  tick(): Promise<number>;
}
export const ANALYTICS_RUNNER = Symbol('ANALYTICS_RUNNER');
