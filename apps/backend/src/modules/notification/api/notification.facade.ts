// The api/ layer may not import domain/; these unions mirror `domain/notification.ts`.
export type NotificationType =
  | 'assistant.report'
  | 'assistant.alert'
  | 'assistant.schedule_paused'
  | 'inbox.handoff'
  | 'inbox.message'
  | 'dataexport.ready'
  | 'dataexport.failed'
  | 'task.due'
  | 'brain.complaint';
export type NotificationChannelKind = 'email' | 'push';
export type DeliveryStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'skipped';
export type NotificationTarget =
  | { kind: 'path'; path: string }
  | { kind: 'assistant_report'; runId: string }
  | { kind: 'conversation'; conversationId: string };

/** What a producer asks the notification module to deliver (T-172, S3-R5). */
export interface NotifyInput {
  accountId: string;
  userId: string;
  workspaceId?: string | null;
  type: NotificationType;
  params: Record<string, string | number | null>;
  /** ≤ 160 chars, already rendered in the recipient's locale. */
  title: string;
  /** ≤ 4 000 chars, plain text. */
  body: string;
  target: NotificationTarget | null;
  channels: ('in_app' | NotificationChannelKind)[];
  /** ≤ 160 chars; a repeated key for the same user stores nothing. */
  dedupKey?: string;
}

/** PUBLIC CONTRACT of the notification module. */
export interface NotificationFacade {
  /** Stores the in-app row and queues one delivery per other channel. */
  notify(i: NotifyInput): Promise<{ id: string; deduped: boolean }>;
  /** The recipient's UI language, so the producer renders in it. */
  recipientLocale(userId: string): Promise<'vi' | 'en'>;
  /** False when `RESEND_API_KEY` is unset: email deliveries are then skipped. */
  emailAvailable(): boolean;
  /** Per notification id, the status of each delivery channel. */
  deliverySummary(
    accountId: string,
    userId: string,
    ids: string[],
  ): Promise<Map<string, Partial<Record<NotificationChannelKind, DeliveryStatus>>>>;
}

export const NOTIFICATION_FACADE = Symbol('NOTIFICATION_FACADE');
