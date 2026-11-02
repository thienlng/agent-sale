/** Background work of the notification module; run by the `worker` entry every 5 s. */
export interface NotificationRunner {
  /** One pass: sends the due email/push deliveries. Returns how many were sent. */
  tick(now?: Date): Promise<number>;
}

export const NOTIFICATION_RUNNER = Symbol('NOTIFICATION_RUNNER');
