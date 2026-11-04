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

/** Two entries whose word sets overlap this much (Jaccard) are likely the same fact (QA DUP-2). */
export const LIKELY_DUPLICATE_JACCARD = 0.6;
/** Below this many content words an entry is too short for the overlap test. */
const MIN_SIMILAR_WORDS = 3;

/**
 * Folded Vietnamese function words and the fillers a review adds around the owner ("chủ tài
 * khoản muốn", "anh/chị thích", "khi", "và"); they carry no fact, so they never count.
 */
const FILLER_WORDS = new Set([
  'a',
  'anh',
  'ban',
  'cac',
  'cho',
  'chi',
  'chu',
  'co',
  'cua',
  'da',
  'dang',
  'de',
  'do',
  'duoc',
  'em',
  'hay',
  'khi',
  'khoan',
  'la',
  'luon',
  'minh',
  'mot',
  'muon',
  'nay',
  'neu',
  'nhe',
  'nhung',
  'nen',
  'se',
  'tai',
  'thi',
  'thich',
  'va',
  've',
  'voi',
  'xem',
]);

/** The content words of a text: normalised syllables without fillers. */
export function memoryWords(text: string): Set<string> {
  return new Set(
    normaliseMemoryText(text)
      .split(' ')
      .filter((w) => w && !FILLER_WORDS.has(w)),
  );
}

/** Token-set Jaccard of two texts' content words (0 when either is too short). */
export function memorySimilarity(a: string, b: string): number {
  const x = memoryWords(a);
  const y = memoryWords(b);
  if (x.size < MIN_SIMILAR_WORDS || y.size < MIN_SIMILAR_WORDS) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared);
}

/** A reworded entry that most likely says the same fact (Jaccard ≥ 0.6 on content words). */
export function isLikelyDuplicate(a: string, b: string): boolean {
  return memorySimilarity(a, b) >= LIKELY_DUPLICATE_JACCARD;
}

/**
 * The share of `text`'s content words that also appear in `inside` (0 when `text` is too short).
 * A reworded or split piece of a longer fact scores high even when the Jaccard is low (QA5 #2).
 */
export function memoryContainment(text: string, inside: string): number {
  const x = memoryWords(text);
  if (x.size < MIN_SIMILAR_WORDS) return 0;
  const y = memoryWords(inside);
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / x.size;
}
