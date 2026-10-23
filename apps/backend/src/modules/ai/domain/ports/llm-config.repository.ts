import type { LlmProviderConfig, TierRouteConfig } from '../llm-config.js';

/** Global configuration, stored with the system role (not tenant data). */
export interface LlmConfigRepository {
  listProviders(): Promise<LlmProviderConfig[]>;
  findProvider(id: string): Promise<LlmProviderConfig | null>;
  /** Insert or update by id. Throws LlmProviderNameTakenError on a duplicate name. */
  saveProvider(provider: LlmProviderConfig): Promise<void>;
  deleteProvider(id: string): Promise<boolean>;
  listRoutes(): Promise<TierRouteConfig[]>;
  saveRoute(route: TierRouteConfig): Promise<void>;
}

export const LLM_CONFIG_REPOSITORY = Symbol('LLM_CONFIG_REPOSITORY');
