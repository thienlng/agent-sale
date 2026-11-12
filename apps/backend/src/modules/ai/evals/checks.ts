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
  /** The titles of the quick replies under the message (the order summary's buttons). */
  quickReplies?: readonly string[];
}

/** One tool the loop ran this turn and whether its result was ok. */
export interface ToolStep {
  name: string;
  ok: boolean;
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
  /** The tools the loop ran this turn, in order. */
  steps?: readonly ToolStep[];
  /** The turn created an order. */
  orderCreated?: boolean;
  /** The requests `record_request` recorded this turn, in order (the in-memory crm writer). */
  requests?: readonly { kind: string; updated: boolean }[];
  customerTexts: readonly string[];
  /** Everything the reply may state figures from: profile, notes, FAQs, situations, products. */
  trusted: readonly string[];
  /**
   * When the turn ran: the pipeline's `<current_time>` block. A date of the next
   * {@link NEAR_DATE_DAYS} days ("cuối tuần này" → 14/11) is derived from it, so it is grounded.
   */
  now?: Date;
}

/** How many days after the turn's date count as derived from `<current_time>` (this and next week). */
export const NEAR_DATE_DAYS = 14;
const SHOP_TIME_ZONE = 'Asia/Ho_Chi_Minh';
// d/m, dd/mm, optionally /yy or /yyyy; not part of a longer slash or digit run.
const DATE = /(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/g;

/** The shop's calendar date of `now`, as UTC midnight (only the y/m/d fields are read). */
function shopDay(now: Date): Date {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHOP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(now)
    .split('-')
    .map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

/**
 * The reply without the dates the model derived from the turn's `<current_time>` block: a d/m date
 * (with an optional year) that is the turn's day or one of the next {@link NEAR_DATE_DAYS} days.
 * Any other date stays and is checked like every figure.
 */
export function withoutNearDates(reply: string, now: Date): string {
  const near = new Set<string>();
  const start = shopDay(now);
  for (let i = 0; i <= NEAR_DATE_DAYS; i += 1) {
    const day = new Date(start.getTime() + i * 86_400_000);
    near.add(`${day.getUTCDate()}/${day.getUTCMonth() + 1}/${day.getUTCFullYear()}`);
  }
  return reply.replace(DATE, (whole, d: string, m: string, y: string | undefined) => {
    const years = y
      ? [y.length === 2 ? 2000 + Number(y) : Number(y)]
      : [start.getUTCFullYear(), start.getUTCFullYear() + 1];
    return years.some((year) => near.has(`${Number(d)}/${Number(m)}/${year}`)) ? ' ' : whole;
  });
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
  stepChecks(expected, input.steps ?? [], add);
  if (expected.quick_replies) {
    const want = JSON.stringify(expected.quick_replies);
    const found = messages.map((m) => JSON.stringify(m.quickReplies ?? []));
    add(
      'quick_replies',
      found.includes(want),
      found.includes(want)
        ? `a message carries ${want}`
        : `no message carries ${want} (got ${found.filter((f) => f !== '[]').join(', ') || 'none'})`,
    );
  }
  if (expected.order_created !== undefined) {
    const created = input.orderCreated === true;
    add(
      'order_created',
      created === expected.order_created,
      `expected orderCreated ${expected.order_created}, got ${created}`,
    );
  }
  const requests = input.requests ?? [];
  const last = requests.at(-1);
  if (expected.request_recorded !== undefined) {
    const recorded = requests.length > 0;
    add(
      'request_recorded',
      recorded === expected.request_recorded,
      `expected a recorded request ${expected.request_recorded}, got ${requests.length} recorded`,
    );
  }
  if (expected.request_kind !== undefined)
    add(
      'request_kind',
      last?.kind === expected.request_kind,
      `expected kind ${expected.request_kind}, got ${last?.kind ?? 'no request'}`,
    );
  if (expected.request_updated !== undefined)
    add(
      'request_updated',
      last !== undefined && last.updated === expected.request_updated,
      last
        ? `expected updated ${expected.request_updated}, got ${last.updated}`
        : 'no request recorded',
    );
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
    const reply = input.now ? withoutNearDates(input.reply, input.now) : input.reply;
    const bad = ungroundedFigures(reply, input.trusted, input.customerTexts);
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

/** The tool-step expectations: which tools ran, and which returned an ok result. */
function stepChecks(
  expected: EvalExpect,
  steps: readonly ToolStep[],
  add: (name: string, pass: boolean, detail: string) => void,
): void {
  const ran = steps.map((s) => s.name);
  const succeeded = steps.filter((s) => s.ok).map((s) => s.name);
  const seen = `tools run: ${steps.map((s) => `${s.name}${s.ok ? '' : ' (failed)'}`).join(', ') || 'none'}`;
  const rule = (name: string, names: string[] | undefined, pass: (n: string) => boolean) => {
    if (!names) return;
    const bad = names.filter((n) => !pass(n));
    add(name, bad.length === 0, bad.length ? `${JSON.stringify(bad)}; ${seen}` : seen);
  };
  rule('steps_include', expected.steps_include, (n) => ran.includes(n));
  rule('steps_exclude', expected.steps_exclude, (n) => !ran.includes(n));
  rule('steps_succeeded', expected.steps_succeeded, (n) => succeeded.includes(n));
  rule('steps_not_succeeded', expected.steps_not_succeeded, (n) => !succeeded.includes(n));
}
