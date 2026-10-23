import { fillPlaceholders, foldVietnamese, placeholdersIn } from '@agent-sales/shared';

/** A retrieved FAQ the model may cite, keyed by a short id (kb:1…) instead of a UUID. */
export interface KnowledgeSource {
  key: string;
  faqId: string;
  question: string;
  answer: string;
  score: number;
}

/**
 * Turns search hits into citable sources: placeholders are filled with the
 * bot's values, and an entry that still has an unfilled placeholder is
 * dropped — the bot must never quote "{{store.address}}" or guess it.
 */
export function toSources(
  hits: ReadonlyArray<{ id: string; question: string; answer: string; score: number }>,
  placeholders: Readonly<Record<string, string>>,
): KnowledgeSource[] {
  const sources: KnowledgeSource[] = [];
  for (const hit of hits) {
    const question = fillPlaceholders(hit.question, placeholders);
    const answer = fillPlaceholders(hit.answer, placeholders);
    if (placeholdersIn(question).length || placeholdersIn(answer).length) continue;
    sources.push({
      key: `kb:${sources.length + 1}`,
      faqId: hit.id,
      question,
      answer,
      score: hit.score,
    });
  }
  return sources;
}

/** The per-turn knowledge block. Content is data, delimited for the model (docs/06 §3.3). */
export function knowledgeBlock(sources: readonly KnowledgeSource[]): string {
  if (!sources.length) return '<knowledge>\n(no matching entries)\n</knowledge>';
  const entries = sources.map((s) => `[${s.key}]\nQ: ${s.question}\nA: ${s.answer}`);
  return `<knowledge>\n${entries.join('\n\n')}\n</knowledge>`;
}

const MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  nghin: 1_000,
  ngan: 1_000,
  tr: 1_000_000,
  trieu: 1_000_000,
};

// On folded text: a number with optional thousand separators, then an optional unit word.
const NUMBER = /(\d+(?:[.,\s]\d{3})*)(?:\s*(k|nghin|ngan|trieu|tr)\b)?/g;

/** Every value a figure in `text` can stand for: "350k", "350.000" and "350 nghìn" all give 350000. */
function figureValues(text: string): Array<{ raw: string; values: number[] }> {
  const out: Array<{ raw: string; values: number[] }> = [];
  for (const m of foldVietnamese(text).matchAll(NUMBER)) {
    const digits = (m[1] ?? '').replace(/[.,\s]/g, '');
    const base = Number(digits);
    const unit = m[2] ? MULTIPLIERS[m[2]] : undefined;
    out.push({ raw: m[0].trim(), values: unit ? [base, base * unit] : [base] });
  }
  return out;
}

/**
 * Number grounding (docs/06 §3.3 rule 1): every figure in the reply — price,
 * fee, quantity, phone number, hours — must also appear in the trusted text
 * (sources, the bot's own settings, what the customer wrote). Returns the
 * figures that do not; a non-empty result means the reply must not be sent.
 */
export function ungroundedFigures(reply: string, trusted: readonly string[]): string[] {
  const known = new Set(trusted.flatMap((t) => figureValues(t).flatMap((f) => f.values)));
  return figureValues(reply)
    .filter((f) => !f.values.some((v) => known.has(v)))
    .map((f) => f.raw);
}
