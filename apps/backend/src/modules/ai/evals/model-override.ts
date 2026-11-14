import type { LlmEffort, TierRouteConfig } from '../domain/llm-config.js';
import type { LlmConfigRepository } from '../domain/ports/llm-config.repository.js';

/** The model an eval run is forced onto: `--model gpt-6.1-terra` or `--model gpt-6.1-terra@medium`. */
export interface ModelOverride {
  model: string;
  /** `null` keeps the effort of each route. */
  effort: LlmEffort | null;
}

const EFFORTS: readonly LlmEffort[] = ['low', 'medium', 'high'];

export function parseModelOverride(spec: string): ModelOverride {
  const [model = '', effort, ...rest] = spec.trim().split('@');
  if (!model || rest.length) throw new Error(`invalid --model "${spec}": use <model>[@effort]`);
  if (effort === undefined) return { model, effort: null };
  if (!EFFORTS.includes(effort as LlmEffort)) {
    throw new Error(`invalid --model effort "${effort}": use ${EFFORTS.join(', ')}`);
  }
  return { model, effort: effort as LlmEffort };
}

/**
 * Reads the admin LLM configuration but points every tier route at one model, on the provider of
 * the route's primary, with no fallback: a failure is the model's own. Writes are refused, so an
 * eval can never change the configuration.
 */
export class ModelOverrideConfigRepository implements LlmConfigRepository {
  constructor(
    private readonly inner: LlmConfigRepository,
    private readonly override: ModelOverride,
  ) {}

  listProviders() {
    return this.inner.listProviders();
  }

  findProvider(id: string) {
    return this.inner.findProvider(id);
  }

  async listRoutes(): Promise<TierRouteConfig[]> {
    const routes = await this.inner.listRoutes();
    return routes.map((r) => ({
      ...r,
      primary: {
        ...r.primary,
        model: this.override.model,
        effort: this.override.effort ?? r.primary.effort,
      },
      fallback: null,
    }));
  }

  saveProvider(): Promise<void> {
    return Promise.reject(new Error('read-only configuration (eval model override)'));
  }

  deleteProvider(): Promise<boolean> {
    return Promise.reject(new Error('read-only configuration (eval model override)'));
  }

  saveRoute(): Promise<void> {
    return Promise.reject(new Error('read-only configuration (eval model override)'));
  }
}
