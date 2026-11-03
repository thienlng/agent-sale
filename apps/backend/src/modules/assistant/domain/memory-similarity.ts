/** Shorter normalised texts only count as a duplicate when equal, never by containment. */
const MIN_CONTAINED_CHARS = 8;

/** Lowercase, no diacritics (đ → d), punctuation and runs of spaces folded to one space. */
export function normaliseMemoryText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Two entries say the same thing (QA TinyMind B12b): equal once normalised, or one contains the
 * other (the shorter one at least 8 chars, so a short word never blocks a longer fact).
 */
export function isNearDuplicate(a: string, b: string): boolean {
  const x = normaliseMemoryText(a);
  const y = normaliseMemoryText(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= MIN_CONTAINED_CHARS && ` ${long} `.includes(` ${short} `);
}
