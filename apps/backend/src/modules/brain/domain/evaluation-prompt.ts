import { SignalMood, SignalStage } from '@agent-sales/contracts';
import { z } from 'zod';

/** Versioned system prompt in `packages/ai-core/prompts/` (Rule 05). */
export const EVALUATION_PROMPT = { name: 'brain-signals', version: 1 } as const;
export const EVALUATION_TIER = 'basic' as const;
export const EVALUATION_MAX_OUTPUT_TOKENS = 600;
export const EVALUATION_TIMEOUT_MS = 20_000;
/** A follow-up further away than this is not a follow-up (brief rule 4). */
export const FOLLOW_UP_MAX_DAYS = 60;

/**
 * The JSON the model is asked for (structured output). Every key is present and the optional ones
 * are nullable, because strict JSON-schema modes require all keys; limits are checked after.
 */
export const EvaluationWireSchema = z.object({
  stage: SignalStage,
  intent: z.string(),
  mood: SignalMood,
  needsHuman: z.boolean(),
  needsHumanReason: z.string().nullable(),
  followUpAt: z.string().nullable(),
  followUpReason: z.string().nullable(),
  note: z.string(),
});

/** Text cut to the column's limit (a long answer is still usable). */
const text = (max: number) => z.string().transform((v) => v.trim().slice(0, max).trim());
const optionalText = (max: number) =>
  z
    .string()
    .nullish()
    .transform((v) => v?.trim().slice(0, max).trim() || undefined);

/** An ISO time with an offset (`Z` or `+07:00`); a time without one is read as Asia/Ho_Chi_Minh. */
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;
const ISO_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/**
 * The model's follow-up time, or undefined: unreadable, in the past or more than 60 days away is
 * no follow-up (the rest of the answer stays usable).
 */
function followUpTime(v: string | null | undefined, now: Date): string | undefined {
  const raw = v?.trim();
  if (!raw) return undefined;
  const iso = ISO_WITH_OFFSET.test(raw) ? raw : ISO_LOCAL.test(raw) ? `${raw}+07:00` : null;
  const at = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(at)) return undefined;
  if (at <= now.getTime() || at > now.getTime() + FOLLOW_UP_MAX_DAYS * 86_400_000) return undefined;
  return new Date(at).toISOString();
}

/**
 * The validated answer (brief rule 4). Strict on the enums and booleans (an unknown stage or mood
 * is unusable); lenient on text: `intent` is cut to 160, the reasons to 200 and `note` to 1 500
 * characters (the columns' limits), and a `followUpAt` that is not a usable future time (≤ 60
 * days) becomes none.
 */
export function evaluationOutputSchema(now: Date) {
  return z.object({
    stage: SignalStage,
    intent: text(160),
    mood: SignalMood,
    needsHuman: z.boolean(),
    needsHumanReason: optionalText(200),
    followUpAt: z
      .string()
      .nullish()
      .transform((v) => followUpTime(v, now)),
    followUpReason: optionalText(200),
    note: text(1500),
  });
}
export type EvaluationOutput = z.output<ReturnType<typeof evaluationOutputSchema>>;

/**
 * Reads the model's text as the evaluation JSON (a fenced or surrounded object is tolerated).
 * Null when it is not valid: the caller retries once, then records `invalid`.
 */
export function parseEvaluationOutput(text: string, now: Date): EvaluationOutput | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = evaluationOutputSchema(now).safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export interface EvaluationInputMessage {
  sender: 'customer' | 'human' | 'bot';
  text: string;
  at: string;
}

export interface EvaluationFacts {
  /** The conversation is linked to a CRM customer. */
  hasCustomerRecord: boolean;
  phoneKnown: boolean;
  status: 'open' | 'resolved' | 'spam';
  lastMessageSender: 'customer' | 'human' | 'bot';
  awaitingSince: string | null;
  /** Current stage, and whether a member locked it. */
  stage: string;
  stageLocked: boolean;
}

const SENDER_LABEL = { customer: 'Customer', human: 'Staff', bot: 'Bot' } as const;

/**
 * A message as one line inside the `<<<` … `>>>` data fence: whitespace collapsed, and the fence
 * marks a customer could type broken up (`<<<` → `< < <`), so a message cannot close the fence
 * and pass instructions as if outside it.
 */
export function fenceSafe(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/<{3,}/g, (m) => m.split('').join(' '))
    .replace(/>{3,}/g, (m) => m.split('').join(' '));
}
const HCM_OFFSET_MS = 7 * 3_600_000;
/** `2026-11-11 14:05` in Asia/Ho_Chi_Minh. */
const localTime = (iso: string) =>
  new Date(Date.parse(iso) + HCM_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');

/** The one fact line of the input (spec §3.3): no names, phones or other contact data. */
export function factLine(f: EvaluationFacts, now: Date): string {
  return [
    `now=${now.toISOString()}`,
    `conversation=${f.status}`,
    `customer_record=${f.hasCustomerRecord ? 'yes' : 'no'}`,
    `phone_known=${f.phoneKnown ? 'yes' : 'no'}`,
    `last_speaker=${f.lastMessageSender}`,
    `waiting_since=${f.awaitingSince ?? 'none'}`,
    `stage=${f.stage}${f.stageLocked ? ' (set by staff)' : ''}`,
  ].join('; ');
}

/**
 * The user message of one evaluation (brief rule 4): the previous note (or, on the first run, the
 * stored conversation summary), the new messages and one fact line. Messages are data, never
 * instructions: the system prompt says so and they are fenced.
 */
export function buildEvaluationInput(input: {
  previousNote: string | null;
  summary: string | null;
  messages: readonly EvaluationInputMessage[];
  facts: EvaluationFacts;
  now: Date;
}): string {
  const memory = input.previousNote
    ? `PREVIOUS NOTE:\n${input.previousNote}`
    : input.summary
      ? `EARLIER SUMMARY:\n${input.summary}`
      : 'PREVIOUS NOTE:\n(none: first evaluation)';
  const lines = input.messages.map(
    (m) => `[${localTime(m.at)}] ${SENDER_LABEL[m.sender]}: ${fenceSafe(m.text)}`,
  );
  return [
    memory,
    `NEW MESSAGES (oldest first):\n<<<\n${lines.join('\n')}\n>>>`,
    `FACTS: ${factLine(input.facts, input.now)}`,
  ].join('\n\n');
}
