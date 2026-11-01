import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { parseBridgeBaseUrl } from './bridge-url.js';
import { EmulatedToolsProvider } from '../emulated-tools.js';
import {
  type ChatMessage,
  type GenerateRequest,
  type GenerateResponse,
  INVALID_JSON_INPUT_KEY,
  type LlmErrorKind,
  LlmCallError,
  type LlmProvider,
  type ModelTarget,
  type ToolCall,
} from '../gateway.js';

const BridgeReply = z.object({
  version: z.literal(1),
  text: z.string().max(100_000),
  toolCalls: z
    .array(z.object({ id: z.string().min(1), name: z.string().min(1), arguments: z.string() }))
    .max(64)
    .default([]),
  stopReason: z.enum(['end', 'max_tokens', 'tool_use', 'refusal']).optional(),
  model: z.string().min(1).max(200),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
  }),
});
// An empty text with no tool calls is a valid (empty) answer; the gateway decides on retries.

/** Wire form of a history message (bridge contract v2). */
function toBridgeMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === 'tool' && message.toolCallId)
    return {
      role: 'tool',
      content: message.content,
      toolCallId: message.toolCallId,
      ...(message.name ? { name: message.name } : {}),
    };
  if (message.role === 'assistant' && message.toolCalls?.length)
    return {
      role: 'assistant',
      content: message.content,
      toolCalls: message.toolCalls.map((call) => ({
        id: call.id,
        name: call.name,
        arguments: JSON.stringify(call.input ?? {}),
      })),
    };
  return { role: message.role, content: message.content };
}

function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { [INVALID_JSON_INPUT_KEY]: true };
  }
}

function httpErrorKind(status: number): LlmErrorKind {
  if (status === 429) return 'rate_limit';
  if (status === 401 || status === 403) return 'auth';
  if (status >= 500) return 'overloaded';
  if (status === 413) return 'context_too_long';
  if (status === 408) return 'timeout';
  if (status >= 400 && status < 500) return 'invalid_request';
  return 'unknown';
}

/**
 * The bridge may run a turn for its 50 s budget plus a 15 s token refresh. Aborting earlier frees
 * nothing on the bridge: it keeps its single slot busy and answers the next caller with 429.
 */
export const HERMES_MIN_TIMEOUT_MS = 70_000;

const MAX_IMAGE_BODY_BYTES = 256_000 + Math.floor((6_000_000 * 4) / 3) + 4_096;

/** Hermes owns inference; platform authorization, retrieval and delivery stay in NestJS. */
export class HermesProvider implements LlmProvider {
  readonly name: string;
  readonly #endpoint: string;
  readonly #key: string;
  readonly #fetch: typeof fetch;
  readonly #timeout: number;

  constructor(options: {
    name?: string;
    baseURL: string;
    apiKey?: string;
    timeoutMs?: number;
    fetch?: typeof fetch;
  }) {
    const base = parseBridgeBaseUrl(options.baseURL);
    if (!base) throw new Error('Invalid Hermes bridge URL');
    if (!options.apiKey?.trim()) throw new Error('Hermes bridge key is required');
    this.name = options.name ?? 'hermes';
    this.#endpoint = `${base}/v1/generate`;
    this.#key = options.apiKey;
    this.#fetch = options.fetch ?? fetch;
    // The admin form's generic 20 s default must not undercut the bridge's own budget.
    this.#timeout = Math.max(options.timeoutMs ?? HERMES_MIN_TIMEOUT_MS, HERMES_MIN_TIMEOUT_MS);
  }

  async generate(request: GenerateRequest, target: ModelTarget): Promise<GenerateResponse> {
    const started = performance.now();
    const images = request.images?.length ? request.images : undefined;
    const body = JSON.stringify({
      version: 1,
      requestId: randomUUID(),
      workspaceId: request.workspaceId,
      model: target.model,
      effort: target.effort ?? null,
      messages: request.messages.map(toBridgeMessage),
      maxOutputTokens: request.maxOutputTokens ?? 2000,
      responseSchema: request.responseFormat ? z.toJSONSchema(request.responseFormat) : null,
      ...(images ? { images } : {}),
      ...(request.tools?.length
        ? {
            tools: request.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: z.toJSONSchema(tool.input),
            })),
            ...(request.toolChoice ? { toolChoice: request.toolChoice } : {}),
          }
        : {}),
      ...(request.promptCacheKey ? { promptCacheKey: request.promptCacheKey } : {}),
    });
    // The text cap stays; an image request may add the base64 bytes (mirrors the bridge's MAX_IMAGE_BODY).
    const imageChars = images?.reduce((sum, image) => sum + image.base64.length, 0) ?? 0;
    if (
      Buffer.byteLength(body) - imageChars > 256_000 ||
      Buffer.byteLength(body) > MAX_IMAGE_BODY_BYTES
    )
      throw new Error('Hermes context exceeds bridge limit');
    // Per-attempt timeout: the caller's `timeoutMs` when given, never longer than the transport
    // default (the bridge's own 50 s run budget + refresh). Aborting earlier leaves the bridge's
    // single slot busy; its next answer is then 429 with a Retry-After estimate of the remaining
    // time, surfaced as `rate_limit` so the gateway backoff waits instead of hammering.
    // AbortSignal.timeout only takes a whole number of milliseconds.
    const timeout = AbortSignal.timeout(
      Math.max(1, Math.floor(Math.min(request.timeoutMs ?? this.#timeout, this.#timeout))),
    );
    const signal = request.signal ? AbortSignal.any([timeout, request.signal]) : timeout;
    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.#key}` },
        body,
        signal,
        redirect: 'error',
      });
    } catch {
      // Fetch errors can contain private URLs or upstream response text.
      if (request.signal?.aborted)
        throw new LlmCallError('aborted', 'Hermes bridge request aborted');
      if (timeout.aborted) throw new LlmCallError('timeout', 'Hermes bridge request timed out');
      throw new LlmCallError('network', 'Hermes bridge request failed');
    }
    if (!response.ok) {
      const retryAfter = Number(response.headers.get('retry-after'));
      throw new LlmCallError(
        httpErrorKind(response.status),
        `Hermes bridge unavailable (${response.status})`,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
        response.status,
      );
    }
    let result: z.infer<typeof BridgeReply>;
    try {
      const raw = await response.text();
      if (Buffer.byteLength(raw) > 256_000) throw new Error('response too large');
      result = BridgeReply.parse(JSON.parse(raw));
    } catch {
      throw new Error('Invalid Hermes bridge response');
    }
    const toolCalls: ToolCall[] = result.toolCalls.map((call) => ({
      id: call.id,
      name: call.name,
      input: parseArguments(call.arguments),
    }));
    return {
      text: result.text,
      toolCalls,
      stopReason: toolCalls.length ? 'tool_use' : (result.stopReason ?? 'end'),
      usage: result.usage,
      provider: this.name,
      model: result.model,
      latencyMs: Math.round(performance.now() - started),
    };
  }
}

/**
 * Asks the bridge whether it carries native function calls (`/health` → `nativeTools`).
 * `true`/`false` are definitive answers from a bridge that responded; `undefined` means the
 * probe failed (down, slow, non-2xx, bad JSON) and nothing is known.
 */
async function probeHealth(options: {
  baseURL: string;
  fetch?: typeof fetch;
}): Promise<boolean | undefined> {
  const base = parseBridgeBaseUrl(options.baseURL);
  if (!base) return undefined;
  try {
    const response = await (options.fetch ?? fetch)(`${base}/health`, {
      signal: AbortSignal.timeout(2_000),
      redirect: 'error',
    });
    if (!response.ok) return undefined;
    const body: unknown = JSON.parse(await response.text());
    if (typeof body !== 'object' || body === null) return undefined;
    return (body as { nativeTools?: unknown }).nativeTools === true;
  } catch {
    return undefined;
  }
}

/** True only when `/health` says `nativeTools: true`; any failure means "assume emulated". */
export async function probeHermesNativeTools(options: {
  baseURL: string;
  fetch?: typeof fetch;
}): Promise<boolean> {
  return (await probeHealth(options)) === true;
}

/** A failed probe is retried on a later call, at most this often. */
export const HERMES_PROBE_RETRY_MS = 30_000;

/**
 * Hermes with native tools when the bridge supports them, otherwise wrapped in
 * `EmulatedToolsProvider`. A definitive `/health` answer is cached; a failed probe uses
 * emulation for that call and is retried on a later call, at most every 30 s.
 */
export class HermesAutoToolsProvider implements LlmProvider {
  readonly name: string;
  readonly #native: HermesProvider;
  readonly #emulated: EmulatedToolsProvider;
  readonly #probe: () => Promise<boolean | undefined>;
  readonly #now: () => number;
  #known: LlmProvider | undefined;
  #pending: Promise<boolean | undefined> | undefined;
  #lastFailure = Number.NEGATIVE_INFINITY;

  constructor(options: ConstructorParameters<typeof HermesProvider>[0] & { now?: () => number }) {
    this.#native = new HermesProvider(options);
    this.name = this.#native.name;
    this.#emulated = new EmulatedToolsProvider(this.#native);
    this.#now = options.now ?? Date.now;
    this.#probe = () =>
      probeHealth({
        baseURL: options.baseURL,
        ...(options.fetch ? { fetch: options.fetch } : {}),
      });
  }

  async generate(request: GenerateRequest, target: ModelTarget): Promise<GenerateResponse> {
    return (await this.#choose()).generate(request, target);
  }

  async #choose(): Promise<LlmProvider> {
    if (this.#known) return this.#known;
    if (this.#now() - this.#lastFailure < HERMES_PROBE_RETRY_MS) return this.#emulated;
    this.#pending ??= this.#probe().finally(() => {
      this.#pending = undefined;
    });
    const native = await this.#pending;
    if (native === undefined) {
      this.#lastFailure = this.#now();
      return this.#emulated;
    }
    this.#known = native ? this.#native : this.#emulated;
    return this.#known;
  }
}
