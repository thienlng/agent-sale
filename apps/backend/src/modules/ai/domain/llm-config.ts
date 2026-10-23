/** Platform-wide LLM configuration (global, managed by platform admins). Plain data. */

export type LlmProviderKind = 'anthropic' | 'openai_compatible';
export type LlmEffort = 'low' | 'medium' | 'high';
export type Tier = 'basic' | 'smart' | 'pro' | 'neo';
export const TIERS: readonly Tier[] = ['basic', 'smart', 'pro', 'neo'];

export interface LlmProviderOptions {
  structuredOutput: 'json_schema' | 'json_object' | 'none';
  sendReasoningEffort: boolean;
  timeoutMs: number;
}

export const DEFAULT_PROVIDER_OPTIONS: LlmProviderOptions = {
  structuredOutput: 'json_schema',
  sendReasoningEffort: false,
  timeoutMs: 20_000,
};

export interface LlmProviderConfig {
  id: string;
  /** Stable slug, used as the gateway provider name and in metrics/ai_runs. */
  name: string;
  kind: LlmProviderKind;
  baseUrl: string | null;
  /** SecretBox-sealed API key; never leaves the backend. */
  apiKeyCipher: string | null;
  /** Last 4 characters, for the admin UI. */
  apiKeyHint: string | null;
  options: LlmProviderOptions;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ModelTargetConfig {
  providerId: string;
  model: string;
  effort: LlmEffort | null;
}

export interface TierRouteConfig {
  tier: Tier;
  primary: ModelTargetConfig;
  fallback: ModelTargetConfig | null;
  updatedBy: string | null;
  updatedAt: Date;
}

/** Name of the deterministic development provider (outside production); reserved for it. */
export const DEV_FAKE_PROVIDER = 'dev-fake';

export function apiKeyHint(apiKey: string): string {
  return apiKey.length > 8 ? apiKey.slice(-4) : '';
}
