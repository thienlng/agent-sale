import type { AiOutcome } from '@agent-sales/contracts';

import type { BotView } from '../../bot/api/index.js';
import { defaultFallbackMessage, defaultHandoffMessage } from '../domain/default-messages.js';
import { type KnowledgeSource, ungroundedFigures } from '../domain/grounding.js';
import type { ParsedModelReply } from '../domain/model-reply.js';

const MAX_HANDOFF_LEAD = 200;

export interface Decision {
  outcome: AiOutcome;
  reply: string;
  guardrail: string | null;
  used: ReadonlySet<string>;
}

export function fallbackDecision(bot: BotView, guardrail: string | null): Decision {
  return {
    outcome: 'fallback',
    reply: bot.fallbackMessage.trim() || defaultFallbackMessage(bot),
    guardrail,
    used: new Set(),
  };
}

/** Turns a model output into the reply that may be sent, applying every guardrail. */
export function decide(
  stopReason: string,
  output: ParsedModelReply,
  bot: BotView,
  sources: KnowledgeSource[],
  customerTexts: string[],
  guidance: string,
  /** Text the model received from tools this turn (catalog and action results): figures in it are grounded. */
  trustedResults: readonly string[] = [],
): Decision {
  // Fallback never sends model text and handoff only a vetted lead-in: an empty setting uses the built-in message.
  const fallback = (guardrail: string | null): Decision => fallbackDecision(bot, guardrail);
  // The shop's own hand-over message always goes out. The model may add one brief sentence
  // before it (an apology, a confirmed phone number); it is dropped when it is long or
  // carries a figure that is neither grounded nor given by the customer.
  const handoff = (guardrail: string | null, lead = ''): Decision => ({
    outcome: 'handoff',
    reply: [lead, bot.handoffMessage.trim() || defaultHandoffMessage(bot)]
      .filter(Boolean)
      .join(' '),
    guardrail,
    used: new Set(),
  });
  if (stopReason === 'refusal') return handoff('provider_refusal');
  if (stopReason === 'max_tokens') return fallback('output_truncated');

  if (!output.ok) return fallback(`invalid_output:${output.reason}`);
  const parsed = output.value;
  const trusted = [
    ...sources.flatMap((s) => [s.question, s.answer]),
    bot.mission,
    bot.greeting,
    guidance,
    ...trustedResults,
    ...Object.values(bot.placeholders),
    // The business profile is given to the model, so its figures (hotline, hours, prices) are grounded.
    ...Object.values(bot.profile.fields),
    bot.profile.notes,
  ];
  if (parsed.outcome === 'handoff') {
    const lead = parsed.reply.trim();
    const safe =
      lead.length <= MAX_HANDOFF_LEAD && !ungroundedFigures(lead, trusted, customerTexts).length;
    return handoff(null, safe ? lead : '');
  }
  if (parsed.outcome === 'unknown' || !parsed.reply.trim()) return fallback(null);

  const ungrounded = ungroundedFigures(parsed.reply, trusted, customerTexts);
  if (ungrounded.length) return fallback(`ungrounded_figure:${ungrounded.join(',')}`);

  const known = new Set(sources.map((s) => s.key));
  return {
    outcome: 'answered',
    reply: parsed.reply.trim(),
    guardrail: null,
    used: new Set(parsed.sources.filter((k) => known.has(k))),
  };
}
