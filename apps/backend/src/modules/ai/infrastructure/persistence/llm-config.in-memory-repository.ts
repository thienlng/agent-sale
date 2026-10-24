import { LlmProviderNameTakenError } from '../../domain/ai.errors.js';
import type { LlmProviderConfig, Tier, TierRouteConfig } from '../../domain/llm-config.js';
import type { LlmConfigRepository } from '../../domain/ports/llm-config.repository.js';

/** DB-less adapter (unit/HTTP tests, quick local runs). Same semantics as the Drizzle one. */
export class InMemoryLlmConfigRepository implements LlmConfigRepository {
  readonly #providers = new Map<string, LlmProviderConfig>();
  readonly #routes = new Map<Tier, TierRouteConfig>();

  async listProviders(): Promise<LlmProviderConfig[]> {
    return [...this.#providers.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async findProvider(id: string): Promise<LlmProviderConfig | null> {
    return this.#providers.get(id) ?? null;
  }

  async saveProvider(provider: LlmProviderConfig): Promise<void> {
    const clash = [...this.#providers.values()].find(
      (p) => p.name === provider.name && p.id !== provider.id,
    );
    if (clash) throw new LlmProviderNameTakenError(provider.name);
    this.#providers.set(provider.id, { ...provider });
  }

  async deleteProvider(id: string): Promise<boolean> {
    return this.#providers.delete(id);
  }

  async listRoutes(): Promise<TierRouteConfig[]> {
    return [...this.#routes.values()].sort((a, b) => a.tier.localeCompare(b.tier));
  }

  async saveRoute(route: TierRouteConfig): Promise<void> {
    this.#routes.set(route.tier, { ...route });
  }
}
