/** Background assistant jobs (the review; later the curator); run by the `worker` entry. */
export interface AssistantRunner {
  /** One pass: claims up to 3 due jobs (5-minute lease) and runs them. */
  tick(): Promise<void>;
}

export const ASSISTANT_RUNNER = Symbol('ASSISTANT_RUNNER');

/**
 * Background work of the assistant (T-172): scheduled reports and alerts. Run by the `worker`
 * entry every 15 s, one tick at a time per process.
 * It has its own worker timer next to the 1c `ASSISTANT_RUNNER` (integration: both tick every
 * 15 s, independently).
 */
export interface AssistantScheduleRunner {
  /** One pass: runs the due schedules (at most 10). Returns how many were claimed. */
  tick(now?: Date): Promise<number>;
}

export const ASSISTANT_SCHEDULE_RUNNER = Symbol('ASSISTANT_SCHEDULE_RUNNER');
