/** Worker side of business deletion (ADR-032): purges businesses whose restore window ended. */
export interface WorkspacePurgeRunner {
  /** Purges at most a few due businesses (throttled to one scan every few minutes). */
  tick(now?: Date): Promise<number>;
}

export const WORKSPACE_PURGE_RUNNER = Symbol('WORKSPACE_PURGE_RUNNER');
