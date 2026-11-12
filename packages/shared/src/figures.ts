import { foldVietnamese } from './text.js';

/**
 * Number grounding for AI-written customer text (docs/06 §3.3 rule 1): the figures of a reply
 * must come from trusted text. Pure; shared by the bot's reply pipeline, the care agent and the
 * ai evals.
 */

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
 * The smallest bare number the `risky` mode checks: prices written without a unit ("350.000"),
 * phone, account and order numbers. Smaller bare numbers (sizes, days, quantities, times) pass.
 */
export const RISKY_FIGURE_MIN = 1_000;

export interface GroundingOptions {
  /**
   * Only money and bare numbers ≥ {@link RISKY_FIGURE_MIN} (the production guardrail): a made-up
   * price, fee, phone or account number is what hurts, and small numbers ("1 phút", "size 42")
   * would make the guard fire on harmless replies. The evals check every figure (false).
   */
  risky?: boolean;
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
  options: GroundingOptions = {},
): string[] {
  const candidates = figures(reply).filter(
    (f) => !options.risky || f.money || f.value >= RISKY_FIGURE_MIN,
  );
  if (!candidates.length) return [];
  const known = new Set(trusted.flatMap((t) => figures(t).map((f) => f.value)));
  const fromCustomer = new Set(
    customer.flatMap((t) =>
      figures(t)
        .filter((f) => !f.money)
        .map((f) => f.value),
    ),
  );
  return candidates
    .filter((f) => !known.has(f.value) && (f.money || !fromCustomer.has(f.value)))
    .map((f) => f.raw);
}
