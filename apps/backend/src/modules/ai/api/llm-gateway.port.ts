import type { GenerateRequest, GenerateResponse } from '@agent-sales/ai-core';
import { DomainError } from '@agent-sales/shared';

/** The runtime LLM gateway (tier routes from the platform LLM configuration) for other modules' agents. */
export interface LlmGatewayPort {
  generate(request: GenerateRequest): Promise<GenerateResponse>;
}
export const AI_LLM_GATEWAY = Symbol('AI_LLM_GATEWAY');

/**
 * True when `generate` failed because no route serves the requested tier (production only; it
 * answers 503 `AI_UNAVAILABLE`). A provider failure (also `AI_UNAVAILABLE`) is not this error.
 */
export function isAiNotConfiguredError(e: unknown): boolean {
  return (
    e instanceof DomainError && e.code === 'AI_UNAVAILABLE' && e.name === 'AiNotConfiguredError'
  );
}

/**
 * True when `generate` failed because the providers rate-limited the call (HTTP 429 after the
 * gateway's retries), read from `AiProviderFailedError.kind`.
 */
export function isModelRateLimitedError(e: unknown): boolean {
  return (
    e instanceof DomainError &&
    e.name === 'AiProviderFailedError' &&
    (e as DomainError & { kind?: unknown }).kind === 'rate_limit'
  );
}
