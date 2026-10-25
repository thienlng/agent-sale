import { DomainError } from '@agent-sales/shared';

export class ActionNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(id: string) {
    super('Action not found', { id });
  }
}

export class InvalidActionError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
}
