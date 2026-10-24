import { DomainError } from '@agent-sales/shared';

export class InvalidFaqError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
}

export class FaqNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(id: string) {
    super('FAQ not found', { id });
  }
}
