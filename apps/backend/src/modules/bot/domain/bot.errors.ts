import { DomainError } from '@agent-sales/shared';

export class InvalidBotError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
}

export class BotNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(id: string) {
    super('Bot not found', { id });
  }
}
