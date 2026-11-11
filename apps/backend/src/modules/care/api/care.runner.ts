/** Worker side of the care module, ticked every 15 s by apps/backend's worker entry. */
export interface CareRunner {
  /**
   * One pass: enrolls and stops cycles from the outbox, expires drafts whose window closed, then
   * runs the due steps. Returns how many steps it ran.
   */
  tick(now?: Date): Promise<number>;
}

export const CARE_RUNNER = Symbol('CARE_RUNNER');
