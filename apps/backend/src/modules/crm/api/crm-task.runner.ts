/** Background work of crm tasks (CRM-04); run by the `worker` entry every 30 s. */
export interface CrmTaskRunner {
  /** Notifies the assignees of tasks that just came due, once each. Returns how many it notified. */
  tick(now?: Date): Promise<number>;
}

export const CRM_TASK_RUNNER = Symbol('CRM_TASK_RUNNER');
