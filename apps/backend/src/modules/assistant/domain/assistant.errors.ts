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

/** Placeholder for a use case a later slice adds (answers 500 INTERNAL). */
export class AssistantNotImplementedError extends DomainError {
  readonly code = 'INTERNAL';
  constructor() {
    super('not implemented');
  }
}
