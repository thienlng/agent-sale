import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { parseBridgeBaseUrl } from './bridge-url.js';
import type { GenerateRequest, GenerateResponse, LlmProvider, ModelTarget } from '../gateway.js';

const BridgeReply = z.object({
  version: z.literal(1),
  text: z.string().min(1).max(100_000),
  model: z.string().min(1).max(200),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
  }),
});

/**
 * The bridge may run a turn for its 50 s budget plus a 15 s token refresh. Aborting earlier frees
 * nothing on the bridge: it keeps its single slot busy and answers the next caller with 429.
 */
export const HERMES_MIN_TIMEOUT_MS = 70_000;

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
    if (request.tools?.length) throw new Error('Hermes bridge tools are not enabled');
    const started = performance.now();
    const body = JSON.stringify({
      version: 1,
      requestId: randomUUID(),
      workspaceId: request.workspaceId,
      model: target.model,
      effort: target.effort ?? null,
      messages: request.messages,
      maxOutputTokens: request.maxOutputTokens ?? 2000,
      responseSchema: request.responseFormat ? z.toJSONSchema(request.responseFormat) : null,
    });
    if (Buffer.byteLength(body) > 256_000) throw new Error('Hermes context exceeds bridge limit');
    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.#key}` },
        body,
        signal: AbortSignal.timeout(this.#timeout),
        redirect: 'error',
      });
    } catch {
      // Fetch errors can contain private URLs or upstream response text.
      throw new Error('Hermes bridge request failed');
    }
    if (!response.ok) throw new Error(`Hermes bridge unavailable (${response.status})`);
    let result: z.infer<typeof BridgeReply>;
    try {
      const raw = await response.text();
      if (Buffer.byteLength(raw) > 256_000) throw new Error('response too large');
      result = BridgeReply.parse(JSON.parse(raw));
    } catch {
      throw new Error('Invalid Hermes bridge response');
    }
    return {
      text: result.text,
      toolCalls: [],
      stopReason: 'end',
      usage: result.usage,
      provider: this.name,
      model: result.model,
      latencyMs: Math.round(performance.now() - started),
    };
  }
}
