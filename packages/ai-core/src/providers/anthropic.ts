import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import type {
  GenerateRequest,
  GenerateResponse,
  LlmProvider,
  ModelTarget,
  StopReason,
} from '../gateway.js';

/**
 * Models that accept the server-side refusal fallback (`fallbacks: "default"`):
 * when the model declines, the API re-runs the same request on a model chosen
 * for that refusal category inside the same call.
 */
const SERVER_FALLBACK_MODELS = new Set([
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5',
]);
const SERVER_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export interface AnthropicProviderOptions {
  /** Registry name used by tier policies; defaults to "anthropic". */
  name?: string;
  /** Omit to let the SDK resolve credentials (ANTHROPIC_API_KEY, profiles…). */
  apiKey?: string;
  /** Override for an API gateway or proxy in front of api.anthropic.com. */
  baseURL?: string;
  /** Per-attempt timeout; docs/06 §3.3 caps a turn at 20 s. */
  timeoutMs?: number;
  maxRetries?: number;
  /** Injected in tests. */
  client?: Anthropic;
}

/**
 * Claude via the Messages API. Leading system messages become the cached
 * system prefix (stable per bot), so repeated turns read it from the prompt
 * cache; per-turn knowledge and the conversation go after it.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name: string;
  readonly #client: Anthropic;

  constructor(options: AnthropicProviderOptions = {}) {
    this.name = options.name ?? 'anthropic';
    this.#client =
      options.client ??
      new Anthropic({
        ...(options.apiKey ? { apiKey: options.apiKey } : {}),
        ...(options.baseURL ? { baseURL: options.baseURL } : {}),
        timeout: options.timeoutMs ?? 20_000,
        maxRetries: options.maxRetries ?? 1,
      });
  }

  async generate(request: GenerateRequest, target: ModelTarget): Promise<GenerateResponse> {
    if (request.tools?.length) throw new Error('anthropic provider: tools are not wired yet');
    const { system, messages } = toAnthropicMessages(request);
    const started = performance.now();
    const fallback = SERVER_FALLBACK_MODELS.has(target.model);

    const response = await this.#client.beta.messages.create({
      model: target.model,
      max_tokens: request.maxOutputTokens ?? 2_000,
      ...(system.length ? { system } : {}),
      messages,
      ...(target.effort || request.responseFormat
        ? {
            output_config: {
              ...(target.effort ? { effort: target.effort } : {}),
              ...(request.responseFormat
                ? { format: zodOutputFormat(request.responseFormat) }
                : {}),
            },
          }
        : {}),
      ...(fallback ? { betas: [SERVER_FALLBACK_BETA], fallbacks: 'default' as const } : {}),
    });

    const text = response.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('');
    const usage = response.usage;
    return {
      text,
      toolCalls: [],
      stopReason: toStopReason(response.stop_reason),
      usage: {
        inputTokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0),
        outputTokens: usage.output_tokens,
        cachedInputTokens: usage.cache_read_input_tokens ?? 0,
      },
      provider: this.name,
      // The model that actually served the turn (differs after a server-side fallback).
      model: response.model,
      latencyMs: Math.round(performance.now() - started),
    };
  }
}

function toAnthropicMessages(request: GenerateRequest): {
  system: Anthropic.Beta.BetaTextBlockParam[];
  messages: Anthropic.Beta.BetaMessageParam[];
} {
  const system: Anthropic.Beta.BetaTextBlockParam[] = [];
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of request.messages) {
    if (m.role === 'system') {
      if (messages.length) throw new Error('anthropic provider: system messages must come first');
      system.push({ type: 'text', text: m.content });
    } else if (m.role === 'tool') {
      throw new Error('anthropic provider: tool messages are not wired yet');
    } else {
      messages.push({ role: m.role, content: m.content });
    }
  }
  const last = system.at(-1);
  if (last) last.cache_control = { type: 'ephemeral' };
  return { system, messages };
}

function toStopReason(reason: string | null): StopReason {
  switch (reason) {
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'max_tokens';
    case 'tool_use':
      return 'tool_use';
    case 'refusal':
      return 'refusal';
    default:
      return 'end';
  }
}
