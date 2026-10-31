import type { ChatMessage, GenerateRequest, GenerateResponse } from '@agent-sales/ai-core';
import type { PlaygroundRequest, ProductDto } from '@agent-sales/contracts';

import type { BotActionView, PendingAction } from '../../action/api/index.js';
import { knowledgeBlock, type KnowledgeSource } from '../domain/grounding.js';
import { type ParsedModelReply, parseModelReply, salvageProse } from '../domain/model-reply.js';
import { productDetails } from '../domain/product-view.js';
import { safeJson } from './action-tools.js';
import type { ToolLoopResult } from './tool-loop.js';

/** Last thing the model reads: general questions ("what do you sell?") tempt it into plain prose. */
export const JSON_REMINDER = 'Reply with the JSON object only, as described above.';
export const FORMAT_REMINDER =
  'Reminder: your previous reply was not a JSON object. Reply again with only the JSON object described above, even for a general question.';

/** Added to the system prompt once a website visitor has left a phone number. */
export const PHONE_KNOWN_LINE =
  'The customer already left their phone number; do not ask for it again.';

/** Products already discussed in this conversation: their details, so follow-ups need no tool call. */
export function focusBlock(products: readonly ProductDto[]): string {
  if (!products.length) return '';
  return `<focus_products>\n${safeJson(products.map(productDetails))}\n</focus_products>`;
}

/** The call awaiting the customer's answer: the action's name and stored arguments, never an id or URL. */
export function pendingBlock(waiting: BotActionView, pending: PendingAction): string {
  return `<pending_action>\n${safeJson({
    name: waiting.name,
    args: pending.args,
    askedMinutesAgo: Math.max(0, Math.floor((Date.now() - pending.askedAt.getTime()) / 60_000)),
  })}\n</pending_action>`;
}

export interface TurnContext {
  profile: string;
  sources: readonly KnowledgeSource[];
  /** Post context and the owner's situations (inside `<shop_situations>`). */
  situations: string;
  focus: string;
  pending: string;
  images: string;
}

/**
 * The conversation as chat turns. Customer text is wrapped as data; the context blocks ride on the
 * last customer turn so the cached prefix (system prompt + earlier turns) stays stable.
 */
export function conversation(input: PlaygroundRequest, ctx: TurnContext): ChatMessage[] {
  const firstCustomer = input.messages.findIndex((m) => m.role === 'customer');
  const turns = input.messages.slice(firstCustomer);
  const blocks = [
    ctx.profile,
    knowledgeBlock(ctx.sources),
    `<shop_situations>\n${ctx.situations}\n</shop_situations>`,
    ctx.focus,
    ctx.pending,
    ctx.images,
  ].filter(Boolean);
  return turns.map((m, i): ChatMessage => {
    if (m.role === 'bot') return { role: 'assistant', content: m.content };
    const customer = `<customer>\n${m.content}\n</customer>`;
    return {
      role: 'user',
      content:
        i === turns.length - 1
          ? `${blocks.join('\n\n')}\n\n${customer}\n\n${JSON_REMINDER}`
          : customer,
    };
  });
}

/**
 * The final reply of the tool loop with the format retry and the prose salvage of the original
 * single-turn pipeline. The retry keeps the tools declared (native providers reject tool
 * messages without them) but forbids calling them.
 */
export async function completeFinal(input: {
  base: GenerateRequest;
  loop: ToolLoopResult;
  generate(req: GenerateRequest): Promise<GenerateResponse>;
  warn(message: string): void;
}): Promise<{ res: GenerateResponse; output: ParsedModelReply }> {
  const { base, loop } = input;
  let res = loop.res;
  let output = parseModelReply(res.text);
  // One malformed output is usually a one-off: retry once before giving up on the question.
  if (!output.ok && res.stopReason === 'end') {
    input.warn(`AI output rejected (${output.reason}), retrying once`);
    // The second attempt reminds the model of the output format (the first reply was prose).
    const [system, ...rest] = base.messages;
    const retry = await input.generate({
      ...base,
      messages: [
        ...(system ? [{ ...system, content: `${system.content}\n\n${FORMAT_REMINDER}` }] : []),
        ...rest,
        ...loop.messages,
      ],
      ...(base.tools?.length ? { toolChoice: 'none' as const } : {}),
    });
    res = {
      ...retry,
      latencyMs: res.latencyMs + retry.latencyMs,
      usage: {
        inputTokens: res.usage.inputTokens + retry.usage.inputTokens,
        outputTokens: res.usage.outputTokens + retry.usage.outputTokens,
        cachedInputTokens: res.usage.cachedInputTokens + retry.usage.cachedInputTokens,
      },
    };
    output = parseModelReply(retry.text);
    // Still prose after the reminder: keep a short, grounded, non-leaking answer rather than
    // telling the customer "I have no information" about something the model did answer.
    if (!output.ok && output.reason === 'not_json' && retry.stopReason === 'end') {
      const salvaged = salvageProse(retry.text, system?.content ?? '');
      if (salvaged) output = { ok: true, value: salvaged };
    }
  }
  return { res, output };
}
