/**
 * Background work of the assistant (T-172): scheduled reports and alerts. Run by the `worker`
 * entry every 15 s, one tick at a time per process. When the 1c `ASSISTANT_RUNNER` lands, its
 * tick calls this one after the jobs step (plan ruling 3-P1).
 */
export interface AssistantScheduleRunner {
  /** One pass: runs the due schedules (at most 10). Returns how many were claimed. */
  tick(now?: Date): Promise<number>;
}

export const ASSISTANT_SCHEDULE_RUNNER = Symbol('ASSISTANT_SCHEDULE_RUNNER');
