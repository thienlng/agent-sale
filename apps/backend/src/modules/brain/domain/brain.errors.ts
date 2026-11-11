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

/** Today's evaluations are used up: a reply draft needs one. */
export class BrainCapReachedError extends DomainError {
  readonly code = 'RATE_LIMITED';
  constructor() {
    super("Today's evaluations are used up");
  }
}

/** The model could not draft a reply (failed, timed out or answered nothing). */
export class ReplyDraftFailedError extends DomainError {
  readonly code = 'AI_UNAVAILABLE';
  constructor(reason: 'error' | 'timeout' | 'empty' | 'disabled') {
    super('No reply could be drafted, try again later', { reason });
  }
}

/** Nothing to answer: the conversation has no message yet. */
export class NothingToDraftError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor() {
    super('The conversation has no message to answer');
  }
}

/** The action does not allow that autonomy level. */
export class AutonomyLevelNotAllowedError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(action: string, level: string) {
    super('This action does not allow that level', { action, level });
  }
}
