import { DomainError } from '@agent-sales/shared';

/** A thread, run, memory entry or proposal the owner does not have (another owner's rows look absent, never forbidden). */
export class AssistantNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(what: 'thread' | 'run' | 'memory entry' | 'proposal', id: string) {
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

/**
 * The proposal cannot be decided: 409 CONFLICT with `details.reason` `proposal_not_pending`
 * (already approved, rejected or running) or `proposal_expired` (older than its 24 h).
 */
export class AssistantProposalConflictError extends DomainError {
  readonly code = 'CONFLICT';
  constructor(reason: 'proposal_not_pending' | 'proposal_expired') {
    super(
      reason === 'proposal_expired' ? 'This proposal has expired' : 'This proposal is not pending',
      { reason },
    );
  }
}
