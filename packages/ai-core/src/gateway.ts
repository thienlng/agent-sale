import type { WorkspaceId } from '@agent-sales/shared';
import type { z } from 'zod';

/** Commercial tiers map to pipeline configs, not to fixed models (ADR-005). */
export type ModelTier = 'basic' | 'smart' | 'pro' | 'neo';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Present on tool results. */
  toolCallId?: string;
}

export interface ToolDefinition<TInput = unknown> {
  name: string;
  description: string;
  input: z.ZodType<TInput>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface GenerateRequest {
  workspaceId: WorkspaceId;
  tier: ModelTier;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  /** Stable prefix for prompt caching: tools → system → tenant knowledge. */
  cachePrefixKey?: string;
  maxOutputTokens?: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

export interface GenerateResponse {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
  provider: string;
  model: string;
  latencyMs: number;
}

/** One concrete provider (OpenAI, Anthropic, Google, local…). */
export interface LlmProvider {
  readonly name: string;
  generate(request: GenerateRequest, model: string): Promise<GenerateResponse>;
}

export interface TierPolicy {
  provider: string;
  model: string;
  fallback?: { provider: string; model: string };
}

/**
 * The gateway every caller uses. Owns: tier → model routing, fallback (degraded
 * cost mode), admission control hooks (docs/16 §2b) and metering.
 */
export class LlmGateway {
  readonly #providers = new Map<string, LlmProvider>();

  constructor(
    providers: LlmProvider[],
    private readonly tiers: Record<ModelTier, TierPolicy>,
    private readonly hooks: {
      admit?: (req: GenerateRequest) => Promise<void>;
      record?: (req: GenerateRequest, res: GenerateResponse) => Promise<void>;
    } = {},
  ) {
    for (const p of providers) this.#providers.set(p.name, p);
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    await this.hooks.admit?.(request);
    const policy = this.tiers[request.tier];
    try {
      const res = await this.#call(policy.provider, policy.model, request);
      await this.hooks.record?.(request, res);
      return res;
    } catch (error) {
      if (!policy.fallback) throw error;
      const res = await this.#call(policy.fallback.provider, policy.fallback.model, request);
      await this.hooks.record?.(request, res);
      return res;
    }
  }

  async #call(
    providerName: string,
    model: string,
    request: GenerateRequest,
  ): Promise<GenerateResponse> {
    const provider = this.#providers.get(providerName);
    if (!provider) throw new Error(`LLM provider not registered: ${providerName}`);
    return provider.generate(request, model);
  }
}
