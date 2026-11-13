import { foldVietnamese } from '@agent-sales/shared';

/**
 * Models sometimes double-escape line breaks, so the customer would read a literal `\n`. A sales
 * chat reply has no legitimate use for that sequence (no code, no file paths), so every
 * stand-alone `\n` or `\r\n` becomes a line break; only `\\n` (an escaped backslash) stays. One
 * linear regex pass (T-135).
 */
export function unescapeLineBreaks(reply: string): string {
  return reply.includes('\\') ? reply.replace(/(?<!\\)\\(?:r\\)?n/g, '\n') : reply;
}

/** The model's free-text answer as it may be sent: literal `\n` fixed, outer whitespace trimmed. */
export function normalizeReplyText(text: string): string {
  return withoutMetaLines(
    withoutForeignScripts(withoutRepeatedLines(unescapeLineBreaks(text))),
  ).trim();
}

// Scripts a Vietnamese shop chat never uses; the model sometimes leaks a character ("સố", "જો").
const FOREIGN_SCRIPTS =
  /[\p{Script=Gujarati}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Armenian}\p{Script=Georgian}\p{Script=Ethiopic}]+/u;
// `.test` needs a regex without the `g` flag (no `lastIndex` state); `.replace` needs it.
const FOREIGN_SCRIPTS_ALL = new RegExp(FOREIGN_SCRIPTS.source, 'gu');

/** TM-22: stray characters of scripts no Vietnamese chat uses are dropped. */
export function withoutForeignScripts(text: string): string {
  return FOREIGN_SCRIPTS.test(text)
    ? text
        .replace(FOREIGN_SCRIPTS_ALL, '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/ +([.,!?])/g, '$1')
    : text;
}

// A line about the message instead of to the customer: the model's own reasoning (TM3-8).
// Only clear reasoning openers: "Khách muốn đổi size thì nhắn shop…" is a real answer (review
// 2026-11-13), "Khách hỏi: …" / "Khách đang chào." describing the message is not.
const META_LINE = new RegExp(
  [
    String.raw`^\s*(tin nhắn này|câu (này|hỏi này) (là|thuộc|chỉ|không cần))(?![\p{L}])`,
    String.raw`^\s*(khách( hàng)?|người dùng) (đang|muốn|hỏi|vừa|chỉ|chào|gửi)[^\n]{0,60}[:"“]`,
    String.raw`^\s*(khách( hàng)?|người dùng) (đang|vừa|chỉ) (chào|hỏi thăm|cảm ơn|gửi lời)(?![\p{L}])`,
    String.raw`^\s*(this message|the (customer|user) (is|wants|asks|just|only))(?![\p{L}])`,
  ].join('|'),
  'iu',
);

/** TM3-8: lines that describe the message ("Tin nhắn này là câu chào…") are not sent. */
export function withoutMetaLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !META_LINE.test(line))
    .join('\n');
}

/** A sentence's words as compared for repeats: no "Dạ"/"Vâng" lead, accents, case or marks. */
const wordsOf = (text: string): string[] =>
  foldVietnamese(text)
    .replace(/^\W*(da|vang|yes|ok)\b/u, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** The same words, the same number of times each (order, accents, case and marks ignored). */
const sameWords = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join(' ') === [...b].sort().join(' ');

// Words that carry no fact of their own (particles, pronouns, linking verbs). Negations
// ("không", "chưa") are facts and never in this list.
const FUNCTION_WORDS = new Set(
  'da vang a ah oi nhe nha nhen the thi la co duoc se dang roi nay do va voi cua cho de ma nen em anh chi minh ban hay rat cung van ve'.split(
    ' ',
  ),
);

/** A list item ("- Áo size L: 150.000đ", "1. …", "• …"): only ever dropped as an exact repeat. */
const LIST_ITEM = /^\s*[-•*\d]/u;

/** Below this many words a sentence is only ever dropped as an exact repeat. */
const REWORD_MIN_WORDS = 6;

/**
 * LM3-1 / R5-6: `later` rewords a text already SENT this turn: it has 6 words or more, and every
 * one of its words except particles and pronouns (every figure, name, size, place, negation) is
 * in `earlier`. "phòng Deluxe hướng vườn" never rewords "phòng Deluxe hướng biển".
 */
function rewords(later: readonly string[], earlier: ReadonlySet<string>): boolean {
  if (later.length < REWORD_MIN_WORDS) return false;
  return later.every((w) => FUNCTION_WORDS.has(w) || earlier.has(w));
}

const SENTENCE_END = /(?<=[.!?…])\s+/u;

/**
 * Drops the sentences of `text` that repeat what was said before them. Inside `text` only an
 * exact repeat goes (the same words: two list items, villas or sizes that differ in one word both
 * stay, review 2026-11-13). Against `sent` (texts already sent this turn) a reworded repeat goes
 * too ({@link rewords}), except for list items. A line keeps its other sentences; a line left with
 * none goes; blank lines stay as they are.
 */
function withoutRepeats(text: string, sent: readonly string[]): string {
  const sentParts = sent
    .flatMap((t) => t.split('\n'))
    .flatMap((line) => [line, ...line.split(SENTENCE_END)])
    .map(wordsOf)
    .filter((w) => w.length > 0);
  const sentSets = sentParts.map((w) => new Set(w));
  const own: string[][] = [];
  const kept: string[] = [];
  for (const line of text.split('\n')) {
    if (!wordsOf(line).length) {
      kept.push(line);
      continue;
    }
    const listItem = LIST_ITEM.test(line);
    const sentences = line.split(SENTENCE_END);
    const fresh = sentences.filter((sentence) => {
      const words = wordsOf(sentence);
      if (!words.length) return true;
      const repeat =
        [...own, ...sentParts].some((earlier) => sameWords(words, earlier)) ||
        (!listItem && sentSets.some((earlier) => rewords(words, earlier)));
      if (repeat) return false;
      own.push(words);
      return true;
    });
    if (!fresh.some((sentence) => wordsOf(sentence).length)) continue;
    kept.push(fresh.length === sentences.length ? line : fresh.join(' '));
  }
  return kept.join('\n');
}

/**
 * TM-22: the model sometimes writes the same sentence twice in one answer. A sentence with exactly
 * the words of an earlier one is dropped; anything that differs in a word stays; blank lines stay.
 */
export function withoutRepeatedLines(text: string): string {
  return withoutRepeats(text, []);
}

/**
 * VL-B8 / R5-6: the final answer must not repeat what `send_message` already sent this turn: every
 * sentence of the answer that a sent message already said, or reworded without a new fact, is
 * dropped. Returns '' when nothing new is left.
 */
export function withoutSentLines(answer: string, sent: readonly string[]): string {
  return withoutRepeats(answer, sent).trim();
}

const QUOTE_WORDS = 6;

const words = (text: string): string[] =>
  foldVietnamese(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * Knowledge entries the sent text quotes: the whole answer, or a run of 6 consecutive words of it.
 * Free-text answers cite nothing, so "used" is what the customer actually read.
 */
export function quotedSources(
  sent: string,
  sources: readonly { key: string; answer: string }[],
): Set<string> {
  const said = ` ${words(sent).join(' ')} `;
  const used = new Set<string>();
  for (const source of sources) {
    const answer = words(source.answer);
    if (!answer.length) continue;
    const runs =
      answer.length <= QUOTE_WORDS
        ? [answer]
        : Array.from({ length: answer.length - QUOTE_WORDS + 1 }, (_, i) =>
            answer.slice(i, i + QUOTE_WORDS),
          );
    if (runs.some((run) => said.includes(` ${run.join(' ')} `))) used.add(source.key);
  }
  return used;
}
