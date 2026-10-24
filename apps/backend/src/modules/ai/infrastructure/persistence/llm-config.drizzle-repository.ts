import { type Database, eq, schema, withSystem } from '@agent-sales/db';

import { LlmProviderNameTakenError } from '../../domain/ai.errors.js';
import {
  DEFAULT_PROVIDER_OPTIONS,
  type LlmEffort,
  type LlmProviderConfig,
  type LlmProviderKind,
  type LlmProviderOptions,
  type Tier,
  type TierRouteConfig,
} from '../../domain/llm-config.js';
import type { LlmConfigRepository } from '../../domain/ports/llm-config.repository.js';

const p = schema.llmProviders;
const r = schema.llmTierRoutes;

function toProvider(row: typeof p.$inferSelect): LlmProviderConfig {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as LlmProviderKind,
    baseUrl: row.baseUrl,
    apiKeyCipher: row.apiKeyCipher,
    apiKeyHint: row.apiKeyHint,
    options: { ...DEFAULT_PROVIDER_OPTIONS, ...(row.options as Partial<LlmProviderOptions>) },
    isEnabled: row.isEnabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRoute(row: typeof r.$inferSelect): TierRouteConfig {
  return {
    tier: row.tier as Tier,
    primary: {
      providerId: row.providerId,
      model: row.model,
      effort: row.effort as LlmEffort | null,
    },
    fallback:
      row.fallbackProviderId && row.fallbackModel
        ? {
            providerId: row.fallbackProviderId,
            model: row.fallbackModel,
            effort: row.fallbackEffort as LlmEffort | null,
          }
        : null,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  };
}

/** Platform configuration lives outside tenants: every statement runs as app_system. */
export class DrizzleLlmConfigRepository implements LlmConfigRepository {
  constructor(private readonly systemDb: Database) {}

  listProviders(): Promise<LlmProviderConfig[]> {
    return withSystem(this.systemDb, async (tx) =>
      (await tx.select().from(p).orderBy(p.name)).map(toProvider),
    );
  }

  findProvider(id: string): Promise<LlmProviderConfig | null> {
    return withSystem(this.systemDb, async (tx) => {
      const [row] = await tx.select().from(p).where(eq(p.id, id)).limit(1);
      return row ? toProvider(row) : null;
    });
  }

  async saveProvider(provider: LlmProviderConfig): Promise<void> {
    const row = {
      id: provider.id,
      name: provider.name,
      kind: provider.kind,
      baseUrl: provider.baseUrl,
      apiKeyCipher: provider.apiKeyCipher,
      apiKeyHint: provider.apiKeyHint,
      options: provider.options,
      isEnabled: provider.isEnabled,
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt,
    };
    try {
      await withSystem(this.systemDb, (tx) =>
        tx
          .insert(p)
          .values(row)
          .onConflictDoUpdate({
            target: p.id,
            set: {
              baseUrl: row.baseUrl,
              apiKeyCipher: row.apiKeyCipher,
              apiKeyHint: row.apiKeyHint,
              options: row.options,
              isEnabled: row.isEnabled,
              updatedAt: row.updatedAt,
            },
          }),
      );
    } catch (e) {
      const code =
        (e as { cause?: { code?: string }; code?: string }).cause?.code ??
        (e as { code?: string }).code;
      if (code === '23505') throw new LlmProviderNameTakenError(provider.name);
      throw e;
    }
  }

  deleteProvider(id: string): Promise<boolean> {
    return withSystem(this.systemDb, async (tx) => {
      const rows = await tx.delete(p).where(eq(p.id, id)).returning({ id: p.id });
      return rows.length === 1;
    });
  }

  listRoutes(): Promise<TierRouteConfig[]> {
    return withSystem(this.systemDb, async (tx) =>
      (await tx.select().from(r).orderBy(r.tier)).map(toRoute),
    );
  }

  async saveRoute(route: TierRouteConfig): Promise<void> {
    const row = {
      tier: route.tier,
      providerId: route.primary.providerId,
      model: route.primary.model,
      effort: route.primary.effort,
      fallbackProviderId: route.fallback?.providerId ?? null,
      fallbackModel: route.fallback?.model ?? null,
      fallbackEffort: route.fallback?.effort ?? null,
      updatedBy: route.updatedBy,
      updatedAt: route.updatedAt,
    };
    const { tier: _tier, ...set } = row;
    await withSystem(this.systemDb, (tx) =>
      tx.insert(r).values(row).onConflictDoUpdate({ target: r.tier, set }),
    );
  }
}
