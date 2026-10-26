import { HermesLoginError } from '@agent-sales/ai-core';
import type {
  CreateLlmProviderRequest,
  HermesLoginStatus,
  DiscoverLlmModelsRequest,
  DiscoverLlmModelsResponse,
  LlmModelTarget,
  LlmProviderModelList,
  LlmProviderDto,
  LlmTierRouteDto,
  PutLlmTierRouteRequest,
  TestLlmProviderResponse,
  UpdateLlmProviderRequest,
} from '@agent-sales/contracts';
import { isUuid, newId, workspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { SECRET_BOX, type SecretBox } from '../../../common/security/secret-box.js';
import {
  HermesLoginDisabledError,
  HermesLoginRateLimitedError,
  HermesLoginUnavailableError,
  InvalidLlmConfigError,
  LlmProviderInUseError,
  LlmProviderNotFoundError,
  NotHermesProviderError,
} from '../domain/ai.errors.js';
import {
  apiKeyHint,
  DEFAULT_PROVIDER_OPTIONS,
  DEV_FAKE_PROVIDER,
  type LlmProviderConfig,
  type LlmProviderOptions,
  type ModelTargetConfig,
  type Tier,
  TIERS,
  type TierRouteConfig,
} from '../domain/llm-config.js';
import {
  LLM_CONFIG_REPOSITORY,
  type LlmConfigRepository,
} from '../domain/ports/llm-config.repository.js';
import { LlmRuntime } from './llm-runtime.js';
import { LLM_PROVIDER_FACTORY, type LlmProviderFactory } from './ports/llm-provider-factory.js';

/** Whether the Hermes ChatGPT sign-in is available (config `HERMES_SUBSCRIPTION_LOGIN`). */
export const HERMES_SUBSCRIPTION_LOGIN = Symbol('HERMES_SUBSCRIPTION_LOGIN');

/** Placeholder workspace for admin connection tests; the providers never see it. */
const PLATFORM_TEST_WORKSPACE = workspaceId('00000000-0000-7000-8000-000000000000');

/** Applies the options that were sent; absent keys keep their current value. */
function mergeOptions(
  base: LlmProviderOptions,
  change: { [K in keyof LlmProviderOptions]?: LlmProviderOptions[K] | undefined } = {},
): LlmProviderOptions {
  return {
    structuredOutput: change.structuredOutput ?? base.structuredOutput,
    sendReasoningEffort: change.sendReasoningEffort ?? base.sendReasoningEffort,
    timeoutMs: change.timeoutMs ?? base.timeoutMs,
  };
}

export function toProviderDto(p: LlmProviderConfig): LlmProviderDto {
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    baseUrl: p.baseUrl,
    hasApiKey: p.apiKeyCipher !== null,
    apiKeyHint: p.apiKeyHint,
    options: p.options,
    isEnabled: p.isEnabled,
    updatedAt: p.updatedAt.toISOString(),
  };
}

function toTargetDto(t: ModelTargetConfig): LlmModelTarget {
  return { providerId: t.providerId, model: t.model, effort: t.effort };
}

export function toRouteDto(r: TierRouteConfig): LlmTierRouteDto {
  return {
    tier: r.tier,
    primary: toTargetDto(r.primary),
    fallback: r.fallback ? toTargetDto(r.fallback) : null,
    updatedAt: r.updatedAt.toISOString(),
  };
}

/**
 * Platform back-office use cases for LLM configuration. Every write
 * invalidates the runtime so the next AI call uses the new settings.
 */
@Injectable()
export class LlmAdminService {
  constructor(
    @Inject(LLM_CONFIG_REPOSITORY) private readonly config: LlmConfigRepository,
    @Inject(LLM_PROVIDER_FACTORY) private readonly factory: LlmProviderFactory,
    @Inject(SECRET_BOX) private readonly secrets: SecretBox,
    @Inject(LlmRuntime) private readonly runtime: LlmRuntime,
    @Inject(HERMES_SUBSCRIPTION_LOGIN) private readonly subscriptionLogin: boolean,
  ) {}

  async listProviders(): Promise<LlmProviderDto[]> {
    return (await this.config.listProviders()).map(toProviderDto);
  }

  async createProvider(input: CreateLlmProviderRequest): Promise<LlmProviderDto> {
    if (input.name === DEV_FAKE_PROVIDER) {
      throw new InvalidLlmConfigError(
        `"${DEV_FAKE_PROVIDER}" is reserved for the development model`,
      );
    }
    const now = new Date();
    const provider: LlmProviderConfig = {
      id: newId(),
      name: input.name,
      kind: input.kind,
      baseUrl: input.baseUrl ?? null,
      apiKeyCipher: input.apiKey ? this.secrets.seal(input.apiKey) : null,
      apiKeyHint: input.apiKey ? apiKeyHint(input.apiKey) : null,
      options: mergeOptions(DEFAULT_PROVIDER_OPTIONS, input.options),
      isEnabled: input.isEnabled ?? true,
      createdAt: now,
      updatedAt: now,
    };
    await this.config.saveProvider(provider);
    this.runtime.invalidate();
    return toProviderDto(provider);
  }

  async updateProvider(id: string, change: UpdateLlmProviderRequest): Promise<LlmProviderDto> {
    const current = await this.#provider(id);
    const next: LlmProviderConfig = { ...current, updatedAt: new Date() };
    if (change.baseUrl !== undefined) next.baseUrl = change.baseUrl;
    // A stored key is never sent to a new host the admin did not also give a key for.
    if (next.baseUrl !== current.baseUrl && change.apiKey === undefined) {
      next.apiKeyCipher = null;
      next.apiKeyHint = null;
    }
    if (change.apiKey !== undefined) {
      next.apiKeyCipher = change.apiKey === null ? null : this.secrets.seal(change.apiKey);
      next.apiKeyHint = change.apiKey === null ? null : apiKeyHint(change.apiKey);
    }
    if (change.options) next.options = mergeOptions(current.options, change.options);
    if (change.isEnabled !== undefined) next.isEnabled = change.isEnabled;
    if (['openai_compatible', 'hermes'].includes(next.kind) && !next.baseUrl) {
      throw new InvalidLlmConfigError('baseUrl is required for this provider');
    }
    await this.config.saveProvider(next);
    this.runtime.invalidate();
    return toProviderDto(next);
  }

  async deleteProvider(id: string): Promise<void> {
    await this.#provider(id);
    const usedBy = (await this.config.listRoutes())
      .filter((r) => r.primary.providerId === id || r.fallback?.providerId === id)
      .map((r) => r.tier);
    if (usedBy.length) throw new LlmProviderInUseError(id, usedBy);
    await this.config.deleteProvider(id);
    this.runtime.invalidate();
  }

  /** Sends a tiny prompt with the stored credentials; reports errors instead of throwing. */
  async testProvider(id: string, model: string): Promise<TestLlmProviderResponse> {
    const config = await this.#provider(id);
    const started = performance.now();
    try {
      const res = await this.factory.create(config).generate(
        {
          workspaceId: PLATFORM_TEST_WORKSPACE,
          tier: 'basic',
          messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
          maxOutputTokens: 256,
        },
        { model },
      );
      return { ok: true, latencyMs: res.latencyMs, model: res.model, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - started),
        model: null,
        error: message.slice(0, 500),
      };
    }
  }

  /** ChatGPT sign-in of a Hermes runtime: `status`, `start` (device code) or `logout`. */
  async hermesLogin(id: string, action: 'status' | 'start' | 'logout'): Promise<HermesLoginStatus> {
    const config = await this.#provider(id);
    if (config.kind !== 'hermes') throw new NotHermesProviderError(id);
    if (!this.subscriptionLogin) {
      if (action === 'status') return { state: 'disabled' };
      throw new HermesLoginDisabledError();
    }
    try {
      return await this.factory.hermesLogin(config)[action]();
    } catch (error) {
      if (error instanceof HermesLoginError) {
        if (error.reason === 'rate_limited') throw new HermesLoginRateLimitedError();
        // The bridge rejected our key: a configuration problem the admin can see and fix.
        if (error.reason === 'unauthorized')
          return { state: 'failed', code: 'bridge_key_rejected' };
        throw new HermesLoginUnavailableError(error.reason);
      }
      // Invalid stored URL or missing key.
      throw new InvalidLlmConfigError('The Hermes provider needs a valid base URL and API key');
    }
  }

  /** Short model list of a provider; failures degrade to a `state`, never an error. */
  async listModels(id: string): Promise<LlmProviderModelList> {
    const config = await this.#provider(id);
    const res = await this.factory.listModels(config);
    return { data: res.models.slice(0, 30), state: res.state };
  }

  /**
   * Lists the models a server offers, which doubles as the connection check: it needs no model id.
   * Works on unsaved settings; a stored key is reused only while the host is unchanged.
   */
  async discoverModels(input: DiscoverLlmModelsRequest): Promise<DiscoverLlmModelsResponse> {
    const stored = input.providerId ? await this.#provider(input.providerId) : null;
    const kind = input.kind ?? stored?.kind;
    if (!kind) throw new InvalidLlmConfigError('kind is required');
    const baseUrl = input.baseUrl !== undefined ? input.baseUrl : (stored?.baseUrl ?? null);
    if (['openai_compatible', 'hermes'].includes(kind) && !baseUrl) {
      throw new InvalidLlmConfigError('baseUrl is required for this provider');
    }
    const keepStoredKey = !input.apiKey && stored && baseUrl === stored.baseUrl;
    const apiKeyCipher = input.apiKey
      ? this.secrets.seal(input.apiKey)
      : keepStoredKey
        ? stored.apiKeyCipher
        : null;
    const now = new Date();
    const config: LlmProviderConfig = {
      id: stored?.id ?? newId(),
      name: stored?.name ?? 'draft',
      kind,
      baseUrl,
      apiKeyCipher,
      apiKeyHint: null,
      options: stored?.options ?? DEFAULT_PROVIDER_OPTIONS,
      isEnabled: true,
      createdAt: now,
      updatedAt: now,
    };
    const started = performance.now();
    try {
      const provider = this.factory.create(config);
      if (!provider.listModels) {
        return {
          ok: false,
          latencyMs: 0,
          models: [],
          error: 'This server type cannot list its models; type the model id instead.',
        };
      }
      const models = await provider.listModels();
      return { ok: true, latencyMs: Math.round(performance.now() - started), models, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - started),
        models: [],
        error: message.slice(0, 500),
      };
    }
  }

  async listRoutes(): Promise<LlmTierRouteDto[]> {
    return (await this.config.listRoutes()).map(toRouteDto);
  }

  async putRoute(
    tier: string,
    input: PutLlmTierRouteRequest,
    updatedBy: string,
  ): Promise<LlmTierRouteDto> {
    if (!TIERS.includes(tier as Tier)) throw new InvalidLlmConfigError(`Unknown tier: ${tier}`);
    await this.#provider(input.primary.providerId);
    if (input.fallback) await this.#provider(input.fallback.providerId);
    const route: TierRouteConfig = {
      tier: tier as Tier,
      primary: input.primary,
      fallback: input.fallback,
      updatedBy,
      updatedAt: new Date(),
    };
    await this.config.saveRoute(route);
    this.runtime.invalidate();
    return toRouteDto(route);
  }

  async #provider(id: string): Promise<LlmProviderConfig> {
    const provider = isUuid(id) ? await this.config.findProvider(id) : null;
    if (!provider) throw new LlmProviderNotFoundError(id);
    return provider;
  }
}
