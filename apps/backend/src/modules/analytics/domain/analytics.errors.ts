import { DomainError } from '@agent-sales/shared';

export class AnalyticsNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(id: string) {
    super('Analytics not found', { id });
  }
}
