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
