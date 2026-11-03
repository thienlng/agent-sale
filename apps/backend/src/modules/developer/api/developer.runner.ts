/** Background work of the developer module; run by the `worker` entry. */
export interface DeveloperRunner {
  /**
   * One pass: turns new public outbox events into webhook deliveries, then sends the deliveries
   * that are due. Returns how many deliveries it sent.
   */
  tick(now?: Date): Promise<number>;
}

export const DEVELOPER_RUNNER = Symbol('DEVELOPER_RUNNER');
