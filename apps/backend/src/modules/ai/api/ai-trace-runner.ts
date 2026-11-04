/** Background work of the ai module; run hourly by the `agent` entry (Ruling C5-R11). */
export interface AiTraceRunner {
  /**
   * Deletes shop-bot turn traces and steps older than 30 days, in batches of 5 000 under an
   * advisory lock, until a batch comes back short or 20 batches ran. Returns the rows deleted.
   */
  purgeExpired(now?: Date): Promise<number>;
}

export const AI_TRACE_RUNNER = Symbol('AI_TRACE_RUNNER');
