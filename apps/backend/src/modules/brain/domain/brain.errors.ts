import { DomainError } from '@agent-sales/shared';

/** The conversation does not exist in this workspace (also the cross-tenant answer). */
export class SignalConversationNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(id: string) {
    super('Conversation not found', { id });
  }
}

/** The model failed or answered twice with something unusable; the signals are unchanged. */
export class SignalEvaluationFailedError extends DomainError {
  readonly code = 'AI_UNAVAILABLE';
  constructor(reason: 'invalid' | 'error' | 'timeout') {
    super('The conversation could not be evaluated, try again later', { reason });
  }
}
