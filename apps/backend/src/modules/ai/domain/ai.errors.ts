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

/** The Hermes sign-in endpoints only apply to providers of kind `hermes`. */
export class NotHermesProviderError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(id: string) {
    super('This provider is not a Hermes runtime', { id });
  }
}

/** The bridge refused or could not serve a sign-in request. */
export class HermesLoginUnavailableError extends DomainError {
  readonly code = 'UNAVAILABLE';
  constructor(reason: string) {
    super('The Hermes bridge could not handle the sign-in request', { reason });
  }
}

export class HermesLoginRateLimitedError extends DomainError {
  readonly code = 'RATE_LIMITED';
  constructor() {
    super('The Hermes bridge is rate limiting sign-in attempts');
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
