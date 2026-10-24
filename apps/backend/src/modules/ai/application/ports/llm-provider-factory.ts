import type { LlmProvider } from '@agent-sales/ai-core';

import type { LlmProviderConfig } from '../../domain/llm-config.js';

/** Turns stored provider config into an SDK-backed provider (decrypts the API key). */
export interface LlmProviderFactory {
  create(config: LlmProviderConfig): LlmProvider;
  /** Provider used for tiers without a route outside production; null in production. */
  developmentFallback(): { provider: LlmProvider; model: string } | null;
}

export const LLM_PROVIDER_FACTORY = Symbol('LLM_PROVIDER_FACTORY');
