/**
 * Presentation-only split of one bot answer into short chat bubbles (one idea each), the way a
 * person types on Messenger. Wording is never changed: text is only cut at line breaks and at
 * sentence ends, and adjacent pieces are packed back together when there are too many.
 */
const MAX_BUBBLE_CHARS = 1000;
const SENTENCE_END = /[.!?…;]["”’)\]]*\s+/g;
const ABBREVIATIONS = new Set([
  'tp.',
  'tt.',
  'tx.',
  'q.',
  'p.',
  'ts.',
  'ths.',
  'v.v.',
  'vd.',
  'no.',
]);

function sentences(paragraph: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (const match of paragraph.matchAll(SENTENCE_END)) {
    const end = match.index + match[0].length;
    const head = paragraph.slice(start, match.index + 1);
    const token = (head.split(/\s+/).at(-1) ?? '').toLowerCase();
    // "TP. HCM", "Q. 1", a single initial and "1." list markers are not sentence ends.
    if (ABBREVIATIONS.has(token) || /^[a-zđ]\.$/.test(token) || /^\d+\.$/.test(head.trim()))
      continue;
    const chunk = paragraph.slice(start, end).trim();
    if (chunk) out.push(chunk);
    start = end;
  }
  const tail = paragraph.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

function breakLong(sentence: string): string[] {
  const out: string[] = [];
  let rest = sentence;
  while (rest.length > MAX_BUBBLE_CHARS) {
    const cut = rest.lastIndexOf(' ', MAX_BUBBLE_CHARS);
    const at = cut > 0 ? cut : MAX_BUBBLE_CHARS;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Splits `text` into at most `maxParts` bubbles; a single idea stays one bubble. */
export function splitReply(text: string, maxParts = 4): string[] {
  const pieces = text
    .split(/\n+/)
    .flatMap((line) => sentences(line.trim()))
    .flatMap(breakLong)
    // A bare "ạ." or "!" is not an idea of its own.
    .reduce<string[]>((acc, piece) => {
      if (acc.length && !/[\p{L}\p{N}]/u.test(piece)) acc[acc.length - 1] += ` ${piece}`;
      else acc.push(piece);
      return acc;
    }, []);
  // Too many: merge the adjacent pair that stays shortest until the cap holds.
  while (pieces.length > maxParts) {
    let best = 0;
    for (let i = 1; i < pieces.length - 1; i++)
      if (
        (pieces[i]?.length ?? 0) + (pieces[i + 1]?.length ?? 0) <
        (pieces[best]?.length ?? 0) + (pieces[best + 1]?.length ?? 0)
      )
        best = i;
    pieces.splice(best, 2, `${pieces[best]} ${pieces[best + 1]}`);
  }
  return pieces.length ? pieces : [text.trim()];
}
