import { ungroundedFigures } from '../domain/grounding.js';
import type { EvalExpect, EvalOutcome } from './case.js';

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

/** One message the bot delivered this turn: its text and how many pictures it carried. */
export interface DeliveredMessage {
  text: string;
  images: number;
}

export interface CheckInput {
  /** Every delivered message's text, joined by line breaks (what the customer read). */
  reply: string;
  outcome: EvalOutcome;
  /** The guardrail the pipeline fired (e.g. `interrupted`), null when none. */
  guardrail?: string | null;
  /** Pictures sent in the turn, every message together. */
  images?: number;
  /** The delivered messages in order (`send_message` ones, then the final one). */
  messages?: readonly DeliveredMessage[];
  customerTexts: readonly string[];
  /** Everything the reply may state figures from: profile, notes, FAQs, situations, products. */
  trusted: readonly string[];
}

// A greeting anywhere in the reply: a multi-turn answer must not open the conversation again.
const GREETING = /(xin chào|em chào|shop chào|mình chào|chào (anh|chị|bạn|quý)|\bhello\b|^hi\b)/iu;

const norm = (text: string): string => text.normalize('NFC').toLowerCase();

/** Deterministic checks only (docs/13 §2.3): an absent expectation is not checked. */
export function runChecks(expected: EvalExpect, input: CheckInput): CheckResult[] {
  const results: CheckResult[] = [];
  const add = (name: string, pass: boolean, detail: string) => results.push({ name, pass, detail });
  const reply = norm(input.reply);

  if (expected.outcome)
    add(
      'outcome',
      expected.outcome === input.outcome,
      `expected ${expected.outcome}, got ${input.outcome}`,
    );
  if (expected.outcome_not)
    add(
      'outcome_not',
      expected.outcome_not !== input.outcome,
      `must not be ${expected.outcome_not}, got ${input.outcome}`,
    );
  if (expected.images_min !== undefined) {
    const sent = input.images ?? 0;
    add(
      'images_min',
      sent >= expected.images_min,
      `${sent} pictures sent, min ${expected.images_min}`,
    );
  }
  const messages = input.messages ?? [];
  if (expected.messages_min !== undefined)
    add(
      'messages_min',
      messages.length >= expected.messages_min,
      `${messages.length} messages delivered, min ${expected.messages_min}`,
    );
  if (expected.image_messages_min !== undefined) {
    const withImages = messages.filter((m) => m.images > 0).length;
    add(
      'image_messages_min',
      withImages >= expected.image_messages_min,
      `${withImages} messages with pictures, min ${expected.image_messages_min}`,
    );
  }
  if (expected.images_per_message_max !== undefined) {
    const max = expected.images_per_message_max;
    const most = Math.max(0, ...messages.map((m) => m.images));
    add('images_per_message_max', most <= max, `at most ${most} pictures in a message, max ${max}`);
  }
  if (expected.contains_any) {
    const hit = expected.contains_any.find((s) => reply.includes(norm(s)));
    add(
      'contains_any',
      hit !== undefined,
      hit !== undefined
        ? `found "${hit}"`
        : `none of ${JSON.stringify(expected.contains_any)} in the reply`,
    );
  }
  if (expected.contains_all) {
    const missing = expected.contains_all.filter((s) => !reply.includes(norm(s)));
    add(
      'contains_all',
      missing.length === 0,
      missing.length ? `missing ${JSON.stringify(missing)}` : 'all present',
    );
  }
  if (expected.not_contains) {
    const found = expected.not_contains.filter((s) => reply.includes(norm(s)));
    add(
      'not_contains',
      found.length === 0,
      found.length ? `forbidden text in the reply: ${JSON.stringify(found)}` : 'none present',
    );
  }
  if (expected.max_occurrences) {
    const over = Object.entries(expected.max_occurrences).flatMap(([text, max]) => {
      const count = reply.split(norm(text)).length - 1;
      return count > max ? [`"${text}" ${count}× (max ${max})`] : [];
    });
    add('max_occurrences', over.length === 0, over.length ? over.join(', ') : 'within limits');
  }
  if (expected.not_matches) {
    const found = expected.not_matches.filter((p) =>
      new RegExp(p, 'iu').test(input.reply.normalize('NFC')),
    );
    add(
      'not_matches',
      found.length === 0,
      found.length
        ? `reply matches forbidden pattern: ${JSON.stringify(found)}`
        : 'no pattern matches',
    );
  }
  if (expected.guardrail === 'none') {
    const fired = input.guardrail ?? null;
    add(
      'guardrail',
      fired === null,
      fired === null
        ? 'no guardrail fired'
        : `guardrail fired: ${fired} (the prompt did not produce a safe answer)`,
    );
  }
  if (expected.numbers_only_from_sources) {
    const bad = ungroundedFigures(input.reply, input.trusted, input.customerTexts);
    add(
      'numbers_only_from_sources',
      bad.length === 0,
      bad.length ? `figures not in the sources: ${JSON.stringify(bad)}` : 'all figures grounded',
    );
  }
  if (expected.max_lines !== undefined) {
    const lines = input.reply.split('\n').filter((l) => l.trim()).length;
    add('max_lines', lines <= expected.max_lines, `${lines} lines, max ${expected.max_lines}`);
  }
  if (expected.no_greeting) {
    add('no_greeting', !GREETING.test(input.reply), 'checks the reply for a greeting');
  }
  return results;
}
