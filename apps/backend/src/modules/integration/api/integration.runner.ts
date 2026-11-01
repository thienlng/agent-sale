/** Background PMS sync (full imports, reconciles, webhook deliveries); run by the `worker` entry. */
export interface IntegrationRunner {
  /** One pass: queues due reconciles, runs claimed jobs, applies claimed webhook deliveries. */
  tick(): Promise<void>;
}

export const INTEGRATION_RUNNER = Symbol('INTEGRATION_RUNNER');
