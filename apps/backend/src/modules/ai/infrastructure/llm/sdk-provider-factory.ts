import {
  AnthropicProvider,
  type LlmProvider,
  OpenAiCompatibleProvider,
} from '@agent-sales/ai-core';

import type { SecretBox } from '../../../../common/security/secret-box.js';
import type { LlmProviderFactory } from '../../application/ports/llm-provider-factory.js';
import type { LlmProviderConfig } from '../../domain/llm-config.js';
import { groundedFakeProvider } from './grounded-fake-provider.js';

/** Builds SDK-backed providers; the API key is decrypted only here, in memory. */
export class SdkLlmProviderFactory implements LlmProviderFactory {
  readonly #dev = groundedFakeProvider();

  constructor(
    private readonly secrets: SecretBox,
    private readonly production: boolean,
  ) {}

  create(config: LlmProviderConfig): LlmProvider {
    const apiKey = config.apiKeyCipher ? this.secrets.open(config.apiKeyCipher) : undefined;
    const common = {
      ...(apiKey ? { apiKey } : {}),
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      timeoutMs: config.options.timeoutMs,
    };
    if (config.kind === 'anthropic') return new AnthropicProvider({ ...common, name: config.name });
    return new OpenAiCompatibleProvider({
      ...common,
      name: config.name,
      baseURL: config.baseUrl ?? '',
      structuredOutput: config.options.structuredOutput,
      sendReasoningEffort: config.options.sendReasoningEffort,
    });
  }

  developmentFallback(): { provider: LlmProvider; model: string } | null {
    return this.production ? null : { provider: this.#dev, model: 'grounded-echo' };
  }
}
