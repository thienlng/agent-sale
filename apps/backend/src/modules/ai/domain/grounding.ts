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

// On folded text: a number with optional thousand separators, an optional multiplier word
// and an optional currency ("đ" folds to "d").
const NUMBER = /(\d+(?:[.,\s]\d{3})*)(?:\s*(k|nghin|ngan|trieu|tr)\b)?(?:\s*(d|vnd|dong)\b)?/g;

interface Figure {
  /** As written, folded (lowercase, no diacritics) — used only in guardrail reasons. */
  raw: string;
  /** The amount the figure denotes: "350k", "350.000đ" and "350 nghìn" are all 350000. */
  value: number;
  /** Has a multiplier or a currency, i.e. it is (or looks like) money. */
  money: boolean;
}

// A phone number written with spaces, dots or dashes ("091 234 5678"); its separators are removed
// so it reads as one figure, the same however the customer or the reply spells it.
const PHONE = /(?<!\d)0\d{1,3}(?:[\s.-]?\d{3}){1,2}[\s.-]?\d{3,4}(?!\d)/g;

function figures(text: string): Figure[] {
  const out: Figure[] = [];
  const compact = foldVietnamese(text).replace(PHONE, (m) => m.replace(/[\s.-]/g, ''));
  for (const m of compact.matchAll(NUMBER)) {
    const base = Number((m[1] ?? '').replace(/[.,\s]/g, ''));
    const unit = m[2] ? (MULTIPLIERS[m[2]] ?? 1) : 1;
    out.push({ raw: m[0].trim(), value: base * unit, money: Boolean(m[2] ?? m[3]) });
  }
  return out;
}

/**
 * Number grounding (docs/06 §3.3 rule 1): every figure in the reply — price,
 * fee, quantity, phone number, hours — must denote the same amount as a
 * figure in the trusted text (sources and the bot's own settings). A figure
 * is compared by the amount it denotes, so "42" never vouches for "42k".
 * What the customer wrote may vouch only for non-money figures ("size 42"):
 * a customer must not be able to make the bot confirm a price.
 * Returns the figures that fail; a non-empty result means the reply must not be sent.
 */
export function ungroundedFigures(
  reply: string,
  trusted: readonly string[],
  customer: readonly string[] = [],
): string[] {
  const known = new Set(trusted.flatMap((t) => figures(t).map((f) => f.value)));
  const fromCustomer = new Set(
    customer.flatMap((t) =>
      figures(t)
        .filter((f) => !f.money)
        .map((f) => f.value),
    ),
  );
  return figures(reply)
    .filter((f) => !known.has(f.value) && (f.money || !fromCustomer.has(f.value)))
    .map((f) => f.raw);
}
