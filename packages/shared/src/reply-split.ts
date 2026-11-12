/**
 * Presentation-only split of one bot answer into short chat bubbles (one idea each), the way a
 * person types on Messenger. Wording is never changed: text is only cut at line breaks and at
 * sentence ends, and adjacent pieces are packed back together when there are too many.
 */
const MAX_BUBBLE_CHARS = 1000;
/**
 * A sentence end: `.`, `!`, `?` or `…` (closing quotes or brackets allowed) and a space. Never `;`
 * or `,`, and never before a lowercase letter: those continue the sentence, and a bubble must
 * not start mid-sentence (LM-16, MS-6).
 */
const SENTENCE_END = /[.!?…]["”’)\]]*\s+(?!\p{Ll})/gu;
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

// A line of a server-built summary: a bullet, a numbered item or a short "Label: value".
const SUMMARY_LINE = /^(•|-|\d+\.)\s|^[^.!?:]{1,30}:\s/u;

/**
 * A server-built block (the order or hold summary): three or more lines, most of them bullets or
 * "Label: value". It goes out as one bubble with its line breaks (TM2-9: it was cut into 4 bubbles
 * whose lines ran together, "Phí ship: shop báo sau Tổng: …").
 */
function isSummary(text: string): boolean {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length >= 3 && lines.filter((l) => SUMMARY_LINE.test(l)).length * 2 > lines.length;
}

/** Splits `text` into at most `maxParts` bubbles; a single idea stays one bubble. */
export function splitReply(text: string, maxParts = 4): string[] {
  if (isSummary(text)) return breakLong(text.trim());
  // Each piece remembers whether it starts a new line, so packing keeps the line breaks.
  const pieces = text
    .split(/\n+/)
    .flatMap((line) => sentences(line.trim()).map((s, i) => ({ text: s, line: i === 0 })))
    .flatMap((p) => breakLong(p.text).map((text, i) => ({ text, line: p.line && i === 0 })))
    // A bare "ạ." or "!" is not an idea of its own.
    .reduce<{ text: string; line: boolean }[]>((acc, piece) => {
      const prev = acc[acc.length - 1];
      if (prev && !/[\p{L}\p{N}]/u.test(piece.text)) prev.text += ` ${piece.text}`;
      else acc.push(piece);
      return acc;
    }, []);
  // Too many: merge the adjacent pair that stays shortest until the cap holds.
  while (pieces.length > maxParts) {
    let best = 0;
    for (let i = 1; i < pieces.length - 1; i++)
      if (
        (pieces[i]?.text.length ?? 0) + (pieces[i + 1]?.text.length ?? 0) <
        (pieces[best]?.text.length ?? 0) + (pieces[best + 1]?.text.length ?? 0)
      )
        best = i;
    const [a, b] = [pieces[best], pieces[best + 1]];
    if (!a || !b) break;
    pieces.splice(best, 2, { text: `${a.text}${b.line ? '\n' : ' '}${b.text}`, line: a.line });
  }
  return pieces.length ? pieces.map((p) => p.text) : [text.trim()];
}
