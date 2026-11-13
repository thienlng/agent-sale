import type { AgentStep } from './loop.js';
import { redactSensitive } from './safety.js';

/**
 * Detail of one step: what the owner sees in the debug panel under an answer (the assistant's
 * stored steps and the bot test chat's steps).
 */
export type StepDetail =
  | { tokens: { input: number; cached: number; output: number }; requested: string[] }
  | { args: string; resultChars: number; result: string };

const ARGS_MAX = 500;
const RESULT_MAX = 600;
/** The column's CHECK allows 4096 bytes of JSON; stay below it whatever the script. */
const BYTES_MAX = 4000;

const json = (v: unknown): string => {
  if (v === undefined) return '';
  try {
    return typeof v === 'string' ? v : (JSON.stringify(v) ?? '');
  } catch {
    return '';
  }
};

const bytes = (v: unknown): number => Buffer.byteLength(JSON.stringify(v), 'utf8');

/**
 * The debug detail of a loop step (T-189): a model call keeps its token usage and the tools it
 * asked for; a tool keeps its arguments and the head of its result, with phones, e-mails, URLs
 * and secrets replaced and both cut short. Null for the other step kinds.
 */
export function stepDetail(s: AgentStep): StepDetail | null {
  if (s.kind === 'model_call' && s.usage) {
    return {
      tokens: {
        input: s.usage.inputTokens,
        cached: s.usage.cachedInputTokens,
        output: s.usage.outputTokens,
      },
      requested: (s.requested ?? []).slice(0, 20).map((n) => n.slice(0, 60)),
    };
  }
  if (s.kind !== 'tool' || (s.input === undefined && s.result === undefined)) return null;
  const raw = s.result ?? '';
  let detail = {
    args: redactSensitive(json(s.input), ARGS_MAX),
    resultChars: raw.length,
    result: redactSensitive(raw, RESULT_MAX),
  };
  // Multi-byte text (Vietnamese) can still exceed the byte cap: shrink the result, then the args.
  while (bytes(detail) > BYTES_MAX && detail.result.length > 0) {
    detail = { ...detail, result: detail.result.slice(0, Math.floor(detail.result.length / 2)) };
  }
  while (bytes(detail) > BYTES_MAX && detail.args.length > 0) {
    detail = { ...detail, args: detail.args.slice(0, Math.floor(detail.args.length / 2)) };
  }
  return detail;
}
