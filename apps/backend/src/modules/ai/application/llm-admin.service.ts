import type {
  CreateLlmProviderRequest,
  LlmModelTarget,
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
  InvalidLlmConfigError,
  LlmProviderInUseError,
  LlmProviderNotFoundError,
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
    if (next.kind === 'openai_compatible' && !next.baseUrl) {
      throw new InvalidLlmConfigError('baseUrl is required for openai_compatible providers');
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
