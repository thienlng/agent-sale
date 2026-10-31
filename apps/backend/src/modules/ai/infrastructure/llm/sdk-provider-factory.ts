import {
  AnthropicProvider,
  EmulatedToolsProvider,
  HermesLoginClient,
  HermesProvider,
  type LlmProvider,
  listProviderModels,
  OpenAiCompatibleProvider,
  type ProviderModelList,
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
    if (config.kind === 'hermes')
      return new EmulatedToolsProvider(
        new HermesProvider({ ...common, name: config.name, baseURL: config.baseUrl ?? '' }),
      );
    if (config.kind === 'anthropic') return new AnthropicProvider({ ...common, name: config.name });
    const emulated = config.options.tools === 'emulated';
    const provider = new OpenAiCompatibleProvider({
      ...common,
      name: config.name,
      baseURL: config.baseUrl ?? '',
      structuredOutput: config.options.structuredOutput,
      sendReasoningEffort: config.options.sendReasoningEffort,
      ...(emulated ? { tools: 'emulated' as const } : {}),
    });
    return emulated ? new EmulatedToolsProvider(provider) : provider;
  }

  hermesLogin(config: LlmProviderConfig): HermesLoginClient {
    return new HermesLoginClient({
      baseURL: config.baseUrl ?? '',
      ...(config.apiKeyCipher ? { apiKey: this.secrets.open(config.apiKeyCipher) } : {}),
    });
  }

  listModels(config: LlmProviderConfig): Promise<ProviderModelList> {
    let apiKey: string | undefined;
    try {
      apiKey = config.apiKeyCipher ? this.secrets.open(config.apiKeyCipher) : undefined;
    } catch {
      return Promise.resolve({ models: [], state: 'unavailable' });
    }
    return listProviderModels({
      kind: config.kind,
      baseURL: config.baseUrl ?? undefined,
      apiKey,
    });
  }

  developmentFallback(): { provider: LlmProvider; model: string } | null {
    return this.production ? null : { provider: this.#dev, model: 'grounded-echo' };
  }
}
