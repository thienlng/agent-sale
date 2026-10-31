import type {
  GenerateRequest,
  GenerateResponse,
  ToolDefinition,
  Usage,
} from '@agent-sales/ai-core';
import type { AiOutcome, ProductDto } from '@agent-sales/contracts';
import { newId } from '@agent-sales/shared';

import type { BotView } from '../../bot/api/index.js';
import type { MessageSink, ReplyOptions } from '../api/reply-options.js';
import { defaultFallbackMessage, defaultHandoffMessage } from '../domain/default-messages.js';
import { normalizeReplyText } from '../domain/reply-text.js';
import { productImages } from '../domain/image-allowlist.js';
import { type ActionToolContext, playgroundConversationId, runActionTool } from './action-tools.js';
import type { AgentLoopResult } from './agent-loop.js';
import { CATALOG_TOOLS, type CatalogToolContext, catalogRunnableTools } from './catalog-tools.js';
import {
  type ImageAllowlist,
  type OutputState,
  outputTools,
  type SentMessage,
} from './output-tools.js';
import type { RunnableTool } from './tool-runner.js';

/** A model's tool set for the loop: definitions for the request, executors for the runner. */
export interface ToolSet {
  definitions: ToolDefinition[];
  runnable: RunnableTool[];
}

export function mergeToolSets(...sets: ToolSet[]): ToolSet {
  return {
    definitions: sets.flatMap((s) => s.definitions),
    runnable: sets.flatMap((s) => s.runnable),
  };
}

/** Executors for the given tool definitions (action tools: writes, run one by one). */
export function writeTools(
  definitions: readonly ToolDefinition[],
  run: (name: string, input: unknown) => Promise<{ content: string; trusted?: string }>,
): RunnableTool[] {
  return definitions.map((d) => ({
    name: d.name,
    readOnly: false,
    schema: d.input,
    run: (input) => run(d.name, input),
  }));
}

/**
 * The tools of one turn, in the order the model sees them: catalog (read-only), `send_message`
 * (not for comment replies) and `handoff`, then the owner's actions. Products whose details the
 * catalog returns make their pictures sendable.
 */
export function turnTools(opts: {
  catalog?: Omit<CatalogToolContext, 'onProducts'>;
  allowlist: ImageAllowlist;
  /** Products whose details the model received (besides making their pictures sendable). */
  onProducts?(products: readonly ProductDto[]): void;
  output: OutputState;
  sink?: MessageSink;
  sendMessage: boolean;
  actions: { definitions: ToolDefinition[]; context: ActionToolContext } | null;
}): ToolSet {
  const { catalog, allowlist, actions } = opts;
  return mergeToolSets(
    catalog
      ? {
          definitions: CATALOG_TOOLS,
          runnable: catalogRunnableTools({
            ...catalog,
            onProducts: (products) => {
              allowlist.add(productImages(products));
              opts.onProducts?.(products);
            },
          }),
        }
      : { definitions: [], runnable: [] },
    outputTools({
      ...(opts.sink ? { sink: opts.sink } : {}),
      allowlist,
      state: opts.output,
      sendMessage: opts.sendMessage,
    }),
    actions
      ? {
          definitions: actions.definitions,
          runnable: writeTools(actions.definitions, (name, input) =>
            runActionTool(actions.context, { id: name, name, input }),
          ),
        }
      : { definitions: [], runnable: [] },
  );
}

const ZERO: Usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };

/**
 * Wraps the model call so every call of the turn (summarizer included) is metered, even when a
 * later call throws and the agent loop never returns its own totals.
 */
export function meteredGenerate(generate: (req: GenerateRequest) => Promise<GenerateResponse>) {
  const meter = {
    usage: { ...ZERO },
    latencyMs: 0,
    calls: 0,
    last: null as GenerateResponse | null,
    generate: async (req: GenerateRequest): Promise<GenerateResponse> => {
      const res = await generate(req);
      meter.calls += 1;
      meter.latencyMs += res.latencyMs;
      meter.usage = {
        inputTokens: meter.usage.inputTokens + res.usage.inputTokens,
        outputTokens: meter.usage.outputTokens + res.usage.outputTokens,
        cachedInputTokens: meter.usage.cachedInputTokens + res.usage.cachedInputTokens,
      };
      meter.last = res;
      return res;
    },
  };
  return meter;
}

export interface ReplyDecision {
  outcome: AiOutcome;
  guardrail: string | null;
  /** The last message of the turn (sent by the caller, not the sink); null when there is none. */
  final: string | null;
}

const fallbackText = (bot: BotView): string =>
  bot.fallbackMessage.trim() || defaultFallbackMessage(bot);
const handoffText = (bot: BotView): string =>
  bot.handoffMessage.trim() || defaultHandoffMessage(bot);

/** Why the turn cannot end with the model's text, or null when it can. */
function forcedGuardrail(loop: AgentLoopResult, actionFallback: string | null | undefined) {
  if (loop.outcome === 'limit') return 'tool_loop_limit';
  if (loop.outcome === 'invalid_tools') return 'invalid_tools';
  if (loop.outcome === 'budget') return 'budget';
  if (actionFallback) return actionFallback;
  if (loop.res?.stopReason === 'max_tokens') return 'output_truncated';
  return null;
}

/**
 * The outcome of a turn (spec §7): `handoff` if the handoff tool ran (or the provider refused);
 * `answered` if anything reached the customer; otherwise `fallback` with the bot's fallback message.
 * Fallback text is never model text. An interrupted turn sends no final message: the caller re-runs.
 */
export function decideReply(input: {
  loop: AgentLoopResult;
  output: OutputState;
  bot: BotView;
  actionFallback: string | null | undefined;
}): ReplyDecision {
  const { loop, output, bot } = input;
  const sentAny = output.sent.length > 0;
  if (loop.outcome === 'interrupted') {
    return sentAny
      ? { outcome: 'answered', guardrail: null, final: null }
      : { outcome: 'fallback', guardrail: 'interrupted', final: null };
  }
  if (output.handoff !== null) {
    const lead = normalizeReplyText(loop.res?.text ?? '');
    return {
      outcome: 'handoff',
      guardrail: null,
      final: [lead, handoffText(bot)].filter(Boolean).join('\n'),
    };
  }
  if (loop.res?.stopReason === 'refusal')
    return { outcome: 'handoff', guardrail: 'provider_refusal', final: handoffText(bot) };
  const forced = forcedGuardrail(loop, input.actionFallback);
  const text = forced ? '' : normalizeReplyText(loop.res?.text ?? '');
  if (text) return { outcome: 'answered', guardrail: null, final: text };
  if (sentAny) return { outcome: 'answered', guardrail: forced, final: null };
  return { outcome: 'fallback', guardrail: forced, final: fallbackText(bot) };
}

/** Every message of the turn in order: the `send_message` ones, then the final one. */
export function turnMessages(output: OutputState, decision: ReplyDecision): SentMessage[] {
  return [
    ...output.sent,
    ...(decision.final ? [{ text: decision.final, images: [], via: 'final' as const }] : []),
  ];
}

/** The ai_runs fields shared by every outcome; usage and latency cover every model call made. */
export function runBase(input: {
  botId: string;
  tier: string;
  options: ReplyOptions;
  promptVersion: string;
  meter: ReturnType<typeof meteredGenerate>;
}) {
  const { botId, options, meter } = input;
  return {
    id: newId(),
    botId,
    // A playground run is remembered under its stable id; a comment reply under none.
    conversationId:
      options.conversationId ?? (options.isTest ? playgroundConversationId(botId) : null),
    tier: input.tier,
    provider: meter.last?.provider ?? 'none',
    model: meter.last?.model ?? 'none',
    promptVersion: input.promptVersion,
    inputTokens: meter.usage.inputTokens,
    outputTokens: meter.usage.outputTokens,
    cachedTokens: meter.usage.cachedInputTokens,
    latencyMs: meter.latencyMs,
    isTest: options.isTest,
    createdAt: new Date(),
  };
}
