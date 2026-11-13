/** Worker side of website chat, run every few minutes by the worker entry. */
export interface WebchatRunner {
  /**
   * Deletes visitor uploads no message referenced within a day (security audit #17). Throttles
   * itself to one pass per hour; returns how many objects it deleted.
   */
  tick(now?: Date): Promise<number>;
}

export const WEBCHAT_RUNNER = Symbol('WEBCHAT_RUNNER');
