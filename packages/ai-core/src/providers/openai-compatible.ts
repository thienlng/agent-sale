import OpenAI from 'openai';
import { z } from 'zod';

import {
  INVALID_JSON_INPUT_KEY,
  LlmCallError,
  type GenerateRequest,
  type GenerateResponse,
  type LlmProvider,
  type ModelTarget,
  type StopReason,
  type ToolCall,
} from '../gateway.js';

/**
 * How the server supports structured output. vLLM, SGLang, LM Studio, Ollama
 * (≥ 0.5) and OpenAI accept `json_schema`; older servers only `json_object`;
 * `none` relies on the prompt alone (callers still validate the JSON).
 */
export type StructuredOutputMode = 'json_schema' | 'json_object' | 'none';

const MAX_LISTED_MODELS = 500;
const MAX_IMAGES = 3;

export interface OpenAiCompatibleProviderOptions {
  /** Registry name used by tier policies, e.g. "openai" or "selfhost". */
  name?: string;
  /** e.g. http://vllm:8000/v1 — any server implementing /v1/chat/completions. */
  baseURL: string;
  /** Many self-hosted servers ignore it; the SDK still needs a value. */
  apiKey?: string;
  structuredOutput?: StructuredOutputMode;
  /** `emulated` = the server has no native tool calling; the caller must emulate it. */
  tools?: 'native' | 'emulated';
  /** Forward ModelTarget.effort as `reasoning_effort` (reasoning models only; others may reject it). */
  sendReasoningEffort?: boolean;
  /** Per-attempt timeout; docs/06 §3.3 caps a turn at 20 s. */
  timeoutMs?: number;
  maxRetries?: number;
  /** Injected in tests. */
  client?: OpenAI;
}

/**
 * Chat Completions against any OpenAI-compatible endpoint — OpenAI itself or a
 * self-hosted model server. Prompt caching is automatic on servers that do
 * prefix caching (vLLM, SGLang); cache hits are read from `cached_tokens`.
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name: string;
  readonly #client: OpenAI;
  readonly #structuredOutput: StructuredOutputMode;
  readonly #sendReasoningEffort: boolean;
  readonly #tools: 'native' | 'emulated';

  constructor(options: OpenAiCompatibleProviderOptions) {
    this.name = options.name ?? 'openai';
    this.#structuredOutput = options.structuredOutput ?? 'json_schema';
    this.#sendReasoningEffort = options.sendReasoningEffort ?? false;
    this.#tools = options.tools ?? 'native';
    this.#client =
      options.client ??
      new OpenAI({
        baseURL: options.baseURL,
        apiKey: options.apiKey || 'not-needed',
        timeout: options.timeoutMs ?? 20_000,
        maxRetries: options.maxRetries ?? 0,
      });
  }

  async generate(request: GenerateRequest, target: ModelTarget): Promise<GenerateResponse> {
    if (request.tools?.length && this.#tools === 'emulated') {
      throw new LlmCallError('invalid_request', `${this.name} provider: tools must be emulated`);
    }
    const messages = this.#withImages(request.messages.map(toOpenAiMessage), request.images);
    const started = performance.now();
    const response = await this.#client.chat.completions.create(
      {
        model: target.model,
        max_completion_tokens: request.maxOutputTokens ?? 2_000,
        messages,
        ...(request.tools?.length
          ? {
              tools: request.tools.map(toOpenAiTool),
              tool_choice: request.toolChoice ?? 'auto',
            }
          : {}),
        ...this.#responseFormat(request),
        ...(this.#sendReasoningEffort && target.effort ? { reasoning_effort: target.effort } : {}),
        ...(request.promptCacheKey ? { prompt_cache_key: request.promptCacheKey } : {}),
      },
      {
        ...(request.signal ? { signal: request.signal } : {}),
        ...(request.timeoutMs ? { timeout: request.timeoutMs } : {}),
      },
    );

    const choice = response.choices[0];
    const usage = response.usage;
    const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
    return {
      text: choice?.message.content ?? '',
      toolCalls: (choice?.message.tool_calls ?? []).flatMap(toToolCall),
      stopReason: toStopReason(choice?.finish_reason, choice?.message.refusal),
      usage: {
        inputTokens: (usage?.prompt_tokens ?? 0) - cached,
        outputTokens: usage?.completion_tokens ?? 0,
        cachedInputTokens: cached,
      },
      provider: this.name,
      model: response.model || target.model,
      latencyMs: Math.round(performance.now() - started),
    };
  }

  async listModels(): Promise<string[]> {
    const ids: string[] = [];
    for await (const model of this.#client.models.list()) {
      ids.push(model.id);
      if (ids.length >= MAX_LISTED_MODELS) break;
    }
    return ids.sort();
  }

  /** Puts the images on the last user message as low-detail data-URI parts (max 3). */
  #withImages(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    images: GenerateRequest['images'],
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    if (!images?.length) return messages;
    if (images.length > MAX_IMAGES)
      throw new LlmCallError(
        'invalid_request',
        `${this.name} provider: at most ${MAX_IMAGES} images`,
      );
    if (this.#tools === 'emulated')
      throw new LlmCallError('invalid_request', `${this.name} provider: images need native tools`);
    const index = messages.findLastIndex((m) => m.role === 'user');
    const last = messages[index];
    if (!last || last.role !== 'user' || typeof last.content !== 'string')
      throw new LlmCallError(
        'invalid_request',
        `${this.name} provider: images need a user message`,
      );
    const content: OpenAI.Chat.ChatCompletionContentPart[] = [
      { type: 'text', text: last.content },
      ...images.map((i) => ({
        type: 'image_url' as const,
        image_url: { url: `data:${i.mimeType};base64,${i.base64}`, detail: 'low' as const },
      })),
    ];
    return messages.map((m, i) => (i === index ? { role: 'user', content } : m));
  }

  #responseFormat(
    request: GenerateRequest,
  ): Pick<OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, 'response_format'> {
    if (!request.responseFormat || this.#structuredOutput === 'none') return {};
    if (this.#structuredOutput === 'json_object') {
      return { response_format: { type: 'json_object' } };
    }
    return {
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'reply',
          strict: true,
          schema: z.toJSONSchema(request.responseFormat) as Record<string, unknown>,
        },
      },
    };
  }
}

function toOpenAiTool(
  tool: NonNullable<GenerateRequest['tools']>[number],
): OpenAI.Chat.ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.input) as Record<string, unknown>,
    },
  };
}

function toToolCall(call: OpenAI.Chat.ChatCompletionMessageToolCall): ToolCall[] {
  if (call.type !== 'function') return [];
  let input: unknown;
  try {
    input = JSON.parse(call.function.arguments);
  } catch {
    input = { [INVALID_JSON_INPUT_KEY]: true };
  }
  return [{ id: call.id, name: call.function.name, input }];
}

function toOpenAiMessage(
  m: GenerateRequest['messages'][number],
): OpenAI.Chat.ChatCompletionMessageParam {
  if (m.role === 'tool') {
    if (!m.toolCallId)
      throw new Error('openai-compatible provider: tool message without toolCallId');
    return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
  }
  if (m.role === 'assistant' && m.toolCalls?.length) {
    return {
      role: 'assistant',
      content: m.content || null,
      tool_calls: m.toolCalls.map((c) => ({
        id: c.id,
        type: 'function' as const,
        function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
      })),
    };
  }
  return { role: m.role, content: m.content };
}

function toStopReason(finish: string | null | undefined, refusal?: string | null): StopReason {
  if (refusal) return 'refusal';
  switch (finish) {
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
      return 'tool_use';
    case 'content_filter':
      return 'refusal';
    default:
      return 'end';
  }
}
