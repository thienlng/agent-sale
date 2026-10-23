import {
  type GenerateRequest,
  type GenerateResponse,
  LlmGateway,
  type LlmProvider,
  type TierPolicy,
} from '@agent-sales/ai-core';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { AiNotConfiguredError, AiProviderFailedError } from '../domain/ai.errors.js';
import {
  type LlmProviderConfig,
  type ModelTargetConfig,
  type Tier,
  TIERS,
} from '../domain/llm-config.js';
import {
  LLM_CONFIG_REPOSITORY,
  type LlmConfigRepository,
} from '../domain/ports/llm-config.repository.js';
import { LLM_PROVIDER_FACTORY, type LlmProviderFactory } from './ports/llm-provider-factory.js';

/** Admin changes reach other processes within this delay; this process sees them at once. */
const CACHE_TTL_MS = 10_000;

interface Snapshot {
  gateway: LlmGateway;
  configured: ReadonlySet<Tier>;
}

/**
 * The gateway as configured by platform admins (llm_providers +
 * llm_tier_routes), rebuilt from the database at most every 10 s. Disabled
 * providers are skipped: a route whose primary is disabled runs on its
 * fallback. Tiers without any usable route fail with AI_UNAVAILABLE in
 * production and use the development fake elsewhere.
 */
@Injectable()
export class LlmRuntime {
  readonly #log = new Logger(LlmRuntime.name);
  #snapshot: Promise<Snapshot> | undefined;
  #loadedAt = 0;

  constructor(
    @Inject(LLM_CONFIG_REPOSITORY) private readonly config: LlmConfigRepository,
    @Inject(LLM_PROVIDER_FACTORY) private readonly factory: LlmProviderFactory,
  ) {}

  /** Called after every admin write so the next request uses the new config. */
  invalidate(): void {
    this.#snapshot = undefined;
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    let snapshot: Snapshot;
    try {
      snapshot = await this.#current();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.#log.error(`Could not load the LLM configuration: ${err.message}`, err.stack);
      throw new AiProviderFailedError();
    }
    if (!snapshot.configured.has(request.tier) && !this.factory.developmentFallback()) {
      throw new AiNotConfiguredError(request.tier);
    }
    try {
      return await snapshot.gateway.generate(request);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.#log.error(
        `LLM call failed on every provider of tier ${request.tier} (workspace ${request.workspaceId}): ${err.message}`,
        err.stack,
      );
      throw new AiProviderFailedError();
    }
  }

  #current(): Promise<Snapshot> {
    if (!this.#snapshot || Date.now() - this.#loadedAt > CACHE_TTL_MS) {
      this.#loadedAt = Date.now();
      const loading: Promise<Snapshot> = this.#load().catch((error: unknown) => {
        // Only forget this load; a newer one started by invalidate() must survive.
        if (this.#snapshot === loading) this.#snapshot = undefined;
        throw error;
      });
      this.#snapshot = loading;
    }
    return this.#snapshot;
  }

  async #load(): Promise<Snapshot> {
    const [providers, routes] = await Promise.all([
      this.config.listProviders(),
      this.config.listRoutes(),
    ]);
    // A provider that cannot be built (e.g. its key no longer decrypts) is skipped,
    // so routes using it run on their fallback instead of failing every tier.
    const enabled = new Map<string, LlmProviderConfig>();
    const instances: LlmProvider[] = [];
    for (const p of providers.filter((c) => c.isEnabled)) {
      try {
        instances.push(this.factory.create(p));
        enabled.set(p.id, p);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.#log.error(`LLM provider ${p.name} skipped: ${err.message}`);
      }
    }

    const dev = this.factory.developmentFallback();
    if (dev) instances.push(dev.provider);
    const unconfigured: TierPolicy = dev
      ? { provider: dev.provider.name, model: dev.model }
      : { provider: '(none)', model: '(none)' };

    const target = (t: ModelTargetConfig | null) => {
      const provider = t && enabled.get(t.providerId);
      if (!t || !provider) return null;
      return { provider: provider.name, model: t.model, ...(t.effort ? { effort: t.effort } : {}) };
    };

    const configured = new Set<Tier>();
    const tiers = Object.fromEntries(TIERS.map((tier) => [tier, unconfigured])) as Record<
      Tier,
      TierPolicy
    >;
    for (const route of routes) {
      const primary = target(route.primary);
      const fallback = target(route.fallback);
      const policy = primary ?? fallback;
      if (!policy) continue;
      tiers[route.tier] = primary && fallback ? { ...primary, fallback } : policy;
      configured.add(route.tier);
    }
    return { gateway: new LlmGateway(instances, tiers), configured };
  }
}
