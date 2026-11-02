import { DomainError } from '@agent-sales/shared';

export class NotificationNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(id: string) {
    super('Notification not found', { id });
  }
}
