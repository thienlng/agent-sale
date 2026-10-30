import { ungroundedFigures } from '../domain/grounding.js';
import type { EvalExpect, EvalOutcome } from './case.js';

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

export interface CheckInput {
  reply: string;
  outcome: EvalOutcome;
  /** The guardrail the pipeline fired (e.g. `ungrounded_figure:299k`), null when none. */
  guardrail?: string | null;
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
