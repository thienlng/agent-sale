/** Worker side of the brain module, ticked every 15 s by apps/backend's worker entry. */
export interface BrainRunner {
  /**
   * One pass: schedules idle evaluations from new customer messages (outbox), puts capped jobs
   * of a past day back in line, then runs the due jobs; at most once a minute it also runs the
   * morning briefing pass. Returns how many jobs it handled.
   */
  tick(now?: Date): Promise<number>;
}

export const BRAIN_RUNNER = Symbol('BRAIN_RUNNER');
