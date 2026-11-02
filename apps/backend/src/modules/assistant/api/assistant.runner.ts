/** Background assistant jobs (the review; later the curator); run by the `worker` entry. */
export interface AssistantRunner {
  /** One pass: claims up to 3 due jobs (5-minute lease) and runs them. */
  tick(): Promise<void>;
}

export const ASSISTANT_RUNNER = Symbol('ASSISTANT_RUNNER');
