import { foldVietnamese } from '@agent-sales/shared';

const MAX_TERMS = 8;

/** Folded (foldVietnamese), punctuation-free, de-duplicated terms, length >= 2, max 8. */
export function catalogTerms(query: string): string[] {
  const words = foldVietnamese(query)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((w) => w.length >= 2);
  return [...new Set(words)].slice(0, MAX_TERMS);
}

/**
 * The child's or learner's age a folded query names ("con 7 tuoi", "be 7t", "be 7"), or null
 * (T-187). Ages above 99 are not ages.
 */
export function queryAge(query: string): number | null {
  const q = foldVietnamese(query);
  const m =
    /(?<![\p{N}.,])(\d{1,2})\s*(?:tuoi|t)(?![\p{L}\p{N}])/u.exec(q) ??
    /(?:^|\s)(?:be|con|chau)\s+(?:nha\s+(?:minh|em|chi|anh)\s+)?(\d{1,2})(?![\p{L}\p{N}.,])/u.exec(
      q,
    );
  return m ? Number(m[1]) : null;
}

/**
 * The age ranges a product text states ("6-7 tuổi", "từ 6 đến 7 tuổi", "8+ tuổi", "trên 16 tuổi",
 * "4 tuổi"), as inclusive [min, max] pairs.
 */
export function ageRanges(text: string): Array<[number, number]> {
  const t = foldVietnamese(text);
  const out: Array<[number, number]> = [];
  const range =
    /(?:tu\s+)?(\d{1,2})\s*(?:-|–|—|den|toi|~)\s*(\d{1,2})\s*(?:tuoi|t)(?![\p{L}\p{N}])/gu;
  for (const m of t.matchAll(range)) out.push([Number(m[1]), Number(m[2])]);
  const rest = t.replace(range, ' ');
  const open = /(?:(tren|tu)\s+)?(\d{1,2})\s*(\+)?\s*(?:tuoi|t)(?![\p{L}\p{N}])/gu;
  for (const m of rest.matchAll(open)) {
    const age = Number(m[2]);
    out.push(m[1] || m[3] ? [m[1] === 'tren' ? age + 1 : age, 99] : [age, age]);
  }
  return out.filter(([min, max]) => min <= max);
}

/** Whether a stated range covers `age`: true, false, or null when the text states no age. */
export function coversAge(text: string, age: number): boolean | null {
  const ranges = ageRanges(text);
  if (!ranges.length) return null;
  return ranges.some(([min, max]) => age >= min && age <= max);
}
