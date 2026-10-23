import { DomainError } from '@agent-sales/shared';

export class InvalidLlmConfigError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
}

export class LlmProviderNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor(id: string) {
    super('LLM provider not found', { id });
  }
}

export class LlmProviderNameTakenError extends DomainError {
  readonly code = 'CONFLICT';
  constructor(name: string) {
    super('An LLM provider with this name already exists', { name });
  }
}

export class LlmProviderInUseError extends DomainError {
  readonly code = 'CONFLICT';
  constructor(id: string, tiers: string[]) {
    super('LLM provider is used by a tier route', { id, tiers });
  }
}

/** No enabled route serves the bot's tier (production only; development uses a fake model). */
export class AiNotConfiguredError extends DomainError {
  readonly code = 'AI_UNAVAILABLE';
  constructor(tier: string) {
    super('No AI model is configured for this tier', { tier });
  }
}

/** Every provider of the tier failed (errors, timeouts). Details are logged, not returned. */
export class AiProviderFailedError extends DomainError {
  readonly code = 'AI_UNAVAILABLE';
  constructor() {
    super('The AI model is temporarily unavailable');
  }
}
