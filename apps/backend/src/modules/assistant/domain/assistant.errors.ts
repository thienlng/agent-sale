import { DomainError } from '@agent-sales/shared';

/** A thread or run the owner does not have (another owner's rows look absent, never forbidden). */
export class AssistantNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(what: 'thread' | 'run', id: string) {
    super(`Assistant ${what} not found`, { id });
  }
}

/** The assistant is for account owners only (billing members and staff are refused). */
export class AssistantForbiddenError extends DomainError {
  readonly code = 'FORBIDDEN';
  constructor() {
    super('Only the account owner can use the assistant');
  }
}

/** Another run of this owner is still answering (409 CONFLICT, `details.reason = assistant_busy`). */
export class AssistantBusyError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('The assistant is still answering the previous message', { reason: 'assistant_busy' });
  }
}

/**
 * The client turn id is already the id of a run the owner does not have (another owner's, or
 * another account's, invisible under RLS): 409 CONFLICT, never a 500.
 */
export class AssistantRunIdTakenError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('This turn id is already used', { reason: 'turn_id_taken' });
  }
}
