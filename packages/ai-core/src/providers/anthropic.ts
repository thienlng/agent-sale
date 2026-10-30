import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

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

const MAX_LISTED_MODELS = 500;

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
    if (request.images?.length) throw new Error('anthropic provider: images are not supported');
    const { system, messages } = toAnthropicMessages(request);
    const started = performance.now();
    const fallback = SERVER_FALLBACK_MODELS.has(target.model);

    const response = await this.#client.beta.messages.create({
      model: target.model,
      max_tokens: request.maxOutputTokens ?? 2_000,
      ...(system.length ? { system } : {}),
      messages,
      ...(request.tools?.length
        ? {
            tools: request.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: z.toJSONSchema(t.input) as Anthropic.Beta.BetaTool.InputSchema,
            })),
            tool_choice: { type: request.toolChoice ?? 'auto' },
          }
        : {}),
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
      toolCalls: response.content.flatMap((block) =>
        block.type === 'tool_use' ? [{ id: block.id, name: block.name, input: block.input }] : [],
      ),
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

  async listModels(): Promise<string[]> {
    const ids: string[] = [];
    for await (const model of this.#client.models.list({ limit: 100 })) {
      ids.push(model.id);
      if (ids.length >= MAX_LISTED_MODELS) break;
    }
    return ids;
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
      if (!m.toolCallId) throw new Error('anthropic provider: tool message without toolCallId');
      const block: Anthropic.Beta.BetaToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: m.toolCallId,
        content: m.content,
      };
      const prev = messages.at(-1);
      // Results of one assistant turn must share a single user message.
      if (prev?.role === 'user' && Array.isArray(prev.content) && isToolResults(prev.content)) {
        prev.content.push(block);
      } else {
        messages.push({ role: 'user', content: [block] });
      }
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      messages.push({
        role: 'assistant',
        content: [
          ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
          ...m.toolCalls.map((c) => ({
            type: 'tool_use' as const,
            id: c.id,
            name: c.name,
            input: c.input ?? {},
          })),
        ],
      });
    } else {
      messages.push({ role: m.role, content: m.content });
    }
  }
  const last = system.at(-1);
  if (last) last.cache_control = { type: 'ephemeral' };
  return { system, messages };
}

function isToolResults(content: Anthropic.Beta.BetaContentBlockParam[]): boolean {
  return content.every((b) => b.type === 'tool_result');
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
