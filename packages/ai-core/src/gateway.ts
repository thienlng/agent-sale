import type { WorkspaceId } from '@agent-sales/shared';
import type { z } from 'zod';

/** Commercial tiers map to pipeline configs, not to fixed models (ADR-005). */
export type ModelTier = 'basic' | 'smart' | 'pro' | 'neo';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Assistant messages that asked for tools. */
  toolCalls?: ToolCall[];
  /** Tool results: the call they answer and the tool's name. */
  toolCallId?: string;
  name?: string;
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

/** A customer image for the last user message. Only the Hermes provider can take images. */
export interface ImageInput {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  base64: string;
}

export interface GenerateRequest {
  workspaceId: WorkspaceId;
  tier: ModelTier;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  /** `none` keeps the tools in the request but forbids calling them. Default `auto`. */
  toolChoice?: 'auto' | 'none';
  /** Stable prefix for prompt caching: tools → system → tenant knowledge. */
  cachePrefixKey?: string;
  maxOutputTokens?: number;
  /**
   * Constrains the reply to JSON matching this schema (structured output).
   * Providers enforce it where they can; callers still parse the text.
   */
  responseFormat?: z.ZodType;
  /** Images attached to the last user message (max 3). Providers without vision must throw. */
  images?: ImageInput[];
  /** Stable key letting providers reuse a cached prompt prefix across calls. */
  promptCacheKey?: string;
  /** Per-call timeout in milliseconds. */
  timeoutMs?: number;
  /** Aborts the call when signalled. */
  signal?: AbortSignal;
}

export type LlmErrorKind =
  | 'rate_limit'
  | 'overloaded'
  | 'timeout'
  | 'network'
  | 'context_too_long'
  | 'auth'
  | 'invalid_request'
  | 'content_filter'
  | 'aborted'
  | 'unknown';

/** A classified model-call failure; the gateway retries or falls back based on `kind`. */
export class LlmCallError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    readonly retryAfterMs?: number,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** `inputTokens` excludes cache reads, which are counted in `cachedInputTokens`. */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

/** Provider-neutral reason the model stopped. `refusal` = declined by provider safety systems. */
export type StopReason = 'end' | 'max_tokens' | 'tool_use' | 'refusal';

export interface GenerateResponse {
  text: string;
  toolCalls: ToolCall[];
  stopReason: StopReason;
  usage: Usage;
  provider: string;
  model: string;
  latencyMs: number;
}

/** Reasoning depth for providers that support it; ignored elsewhere. */
export type Effort = 'low' | 'medium' | 'high';

/** Which model a provider should run, plus per-tier knobs. */
export interface ModelTarget {
  model: string;
  effort?: Effort;
}

/** One concrete provider (OpenAI, Anthropic, Google, local…). */
export interface LlmProvider {
  readonly name: string;
  generate(request: GenerateRequest, target: ModelTarget): Promise<GenerateResponse>;
  /** Model ids the server offers; absent when the provider has no listing endpoint. */
  listModels?(): Promise<string[]>;
}

export interface TierPolicy extends ModelTarget {
  provider: string;
  fallback?: ModelTarget & { provider: string };
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
      const res = await this.#call(policy.provider, policy, request);
      await this.hooks.record?.(request, res);
      return res;
    } catch (error) {
      if (!policy.fallback) throw error;
      const res = await this.#call(policy.fallback.provider, policy.fallback, request);
      await this.hooks.record?.(request, res);
      return res;
    }
  }

  async #call(
    providerName: string,
    target: ModelTarget,
    request: GenerateRequest,
  ): Promise<GenerateResponse> {
    const provider = this.#providers.get(providerName);
    if (!provider) throw new Error(`LLM provider not registered: ${providerName}`);
    const { model, effort } = target;
    return provider.generate(request, effort ? { model, effort } : { model });
  }
}

/** Key of the `input` a provider hands over when a tool call's arguments were not valid JSON. */
export const INVALID_JSON_INPUT_KEY = '__invalidJson';
