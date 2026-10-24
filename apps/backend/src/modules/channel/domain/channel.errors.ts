import { DomainError } from '@agent-sales/shared';
export class ChannelError extends DomainError {
  constructor(
    readonly code: 'NOT_FOUND' | 'CONFLICT' | 'UNAVAILABLE' | 'VALIDATION_FAILED',
    message: string,
  ) {
    super(message);
  }
}
