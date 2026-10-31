import type { WorkspaceId } from '@agent-sales/shared';
import type { z } from 'zod';

import { LlmCallError, classifyLlmError, retryAfterMsOf, type LlmErrorKind } from './llm-errors.js';
import {
  backoffDelayMs,
  isRetryable,
  MAX_RETRIES,
  MAX_RETRY_AFTER_SLEEP_MS,
  sleep,
} from './retry.js';

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

export { LlmCallError, type LlmErrorKind } from './llm-errors.js';

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
  readonly #random: () => number;
  readonly #sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(
    providers: LlmProvider[],
    private readonly tiers: Record<ModelTier, TierPolicy>,
    private readonly hooks: {
      admit?: (req: GenerateRequest) => Promise<void>;
      record?: (req: GenerateRequest, res: GenerateResponse) => Promise<void>;
    } = {},
    options: {
      random?: () => number;
      sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    } = {},
  ) {
    this.#random = options.random ?? Math.random;
    this.#sleep = options.sleep ?? sleep;
    for (const p of providers) this.#providers.set(p.name, p);
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    await this.hooks.admit?.(request);
    const policy = this.tiers[request.tier];
    // `timeoutMs` is the total budget of this call: retries and the fallback included.
    const deadline = request.timeoutMs !== undefined ? Date.now() + request.timeoutMs : undefined;
    let primary: GenerateResponse | undefined;
    let failure: unknown;
    try {
      primary = await this.#withRetries(policy.provider, policy, request, deadline);
    } catch (error) {
      failure = error;
    }
    if (primary && !isEmptyAnswer(primary)) {
      await this.hooks.record?.(request, primary);
      return primary;
    }
    const fallback = policy.fallback;
    if (!fallback || (failure !== undefined && !shouldFallBack(failure, request))) {
      if (primary) {
        await this.hooks.record?.(request, primary);
        return primary;
      }
      throw failure;
    }
    if (request.signal?.aborted) throw failure ?? abortError();
    if (deadline !== undefined && deadline - Date.now() <= 0) {
      if (!primary) throw failure;
      await this.hooks.record?.(request, primary);
      return primary;
    }
    const res = await this.#call(fallback.provider, fallback, withRemaining(request, deadline));
    await this.hooks.record?.(request, res);
    return res;
  }

  /**
   * Calls one provider, retrying retryable failures and empty answers (3 retries
   * in total). Returns the last empty answer if every attempt came back empty.
   */
  async #withRetries(
    providerName: string,
    target: ModelTarget,
    request: GenerateRequest,
    deadline: number | undefined,
  ): Promise<GenerateResponse> {
    for (let attempt = 0; ; attempt++) {
      let failure: unknown;
      let empty: GenerateResponse | undefined;
      try {
        const res = await this.#call(providerName, target, withRemaining(request, deadline));
        if (!isEmptyAnswer(res)) return res;
        empty = res;
      } catch (error) {
        failure = error;
        if (!isRetryable(classifyLlmError(error), statusOf(error))) throw error;
      }
      const exhausted = attempt >= MAX_RETRIES;
      const remaining = deadline === undefined ? Infinity : deadline - Date.now();
      if (exhausted || remaining <= 0 || request.signal?.aborted) {
        if (empty) return empty;
        throw failure;
      }
      const retryAfter = failure === undefined ? undefined : retryAfterMsOf(failure);
      const delay = Math.min(
        backoffDelayMs(attempt, this.#random, retryAfter, request.timeoutMs),
        deadline === undefined ? MAX_RETRY_AFTER_SLEEP_MS : remaining,
      );
      await this.#sleep(delay, request.signal);
      if (deadline !== undefined && deadline - Date.now() <= 0) {
        if (empty) return empty;
        throw failure;
      }
    }
  }

  async #call(
    providerName: string,
    target: ModelTarget,
    request: GenerateRequest,
  ): Promise<GenerateResponse> {
    const provider = this.#providers.get(providerName);
    if (!provider) {
      throw new LlmCallError('invalid_request', `LLM provider not registered: ${providerName}`);
    }
    const { model, effort } = target;
    return provider.generate(request, effort ? { model, effort } : { model });
  }
}

/** Clones the request with `timeoutMs` set to the time left on the call's deadline. */
function withRemaining(request: GenerateRequest, deadline: number | undefined): GenerateRequest {
  if (deadline === undefined) return request;
  return { ...request, timeoutMs: Math.max(1, deadline - Date.now()) };
}

const NO_FALLBACK_KINDS: ReadonlySet<LlmErrorKind> = new Set([
  'aborted',
  'auth',
  'invalid_request',
  'content_filter',
  'context_too_long',
]);

function shouldFallBack(error: unknown, request: GenerateRequest): boolean {
  return !request.signal?.aborted && !NO_FALLBACK_KINDS.has(classifyLlmError(error));
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

function abortError(): Error {
  return Object.assign(new Error('aborted'), { name: 'AbortError' });
}

function isEmptyAnswer(res: GenerateResponse): boolean {
  return !res.text.trim() && res.toolCalls.length === 0 && res.stopReason !== 'refusal';
}

/** Key of the `input` a provider hands over when a tool call's arguments were not valid JSON. */
export const INVALID_JSON_INPUT_KEY = '__invalidJson';
