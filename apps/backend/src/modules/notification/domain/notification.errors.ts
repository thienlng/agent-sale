import { DomainError } from '@agent-sales/shared';

/** Another user's (or account's) notification behaves as absent: 404. */
export class NotificationNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(id: string) {
    super('Notification not found', { id });
  }
}

/** A producer asked for an invalid notification (a programming error, never user input). */
export class NotificationInvalidError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(reason: string) {
    super('Invalid notification', { reason });
  }
}
