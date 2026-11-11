import { DomainError } from '@agent-sales/shared';
export class ConversationError extends DomainError {
  constructor(
    readonly code: 'NOT_FOUND' | 'CONFLICT' | 'UNAVAILABLE' | 'VALIDATION_FAILED',
    message: string,
    /** Why a care message was refused (`details.reason`; see `CareRefusal` in the api). */
    reason?: string,
  ) {
    super(message, reason ? { reason } : undefined);
  }
}
