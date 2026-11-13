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
  /[\p{Script=Gujarati}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Armenian}\p{Script=Georgian}\p{Script=Ethiopic}]+/gu;

/** TM-22: stray characters of scripts no Vietnamese chat uses are dropped. */
export function withoutForeignScripts(text: string): string {
  return FOREIGN_SCRIPTS.test(text)
    ? text
        .replace(FOREIGN_SCRIPTS, '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/ +([.,!?])/g, '$1')
    : text;
}

// A line about the message instead of to the customer: the model's own reasoning (TM3-8).
const META_LINE =
  /^\s*(tin nhắn này|câu (này|hỏi này)|khách (đang|muốn|hỏi|vừa|chỉ)|người dùng|this message|the (customer|user) (is|wants|asks))(?![\p{L}])/iu;

/** TM3-8: lines that describe the message ("Tin nhắn này là câu chào…") are not sent. */
export function withoutMetaLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !META_LINE.test(line))
    .join('\n');
}

/** A sentence as compared for repeats: its words without a "Dạ"/"Vâng" lead, accents or case. */
const wordsOf = (text: string): Set<string> =>
  new Set(
    foldVietnamese(text)
      .replace(/^\W*(da|vang|yes|ok)\b/u, '')
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );

/**
 * `later` says nothing `earlier` did not: a short one (under 6 words) has the same words, a longer
 * one has at least 80% of its own words in `earlier` (LM3-1: a reworded repeat). A figure of
 * `later` that `earlier` lacks always keeps it (R5-4: "EVANI tiêu chuẩn 24 người lớn" then
 * "…tiêu chuẩn 24 người lớn, tối đa 35 khách" is new information, never a repeat).
 */
function repeats(later: Set<string>, earlier: Set<string>): boolean {
  for (const w of later) if (/\d/.test(w) && !earlier.has(w)) return false;
  if (later.size < 6) return later.size === earlier.size && [...later].every((w) => earlier.has(w));
  let shared = 0;
  for (const w of later) if (earlier.has(w)) shared += 1;
  return shared / later.size >= 0.8;
}

const SENTENCE_END = /(?<=[.!?…])\s+/u;

/**
 * Drops every sentence of `text` that repeats one said before it: in `said` (texts already sent
 * this turn) or earlier in `text`. A line keeps its other sentences; a line left with none goes;
 * blank lines stay as they are.
 */
function withoutRepeats(text: string, said: readonly string[]): string {
  const seen: Set<string>[] = [];
  const remember = (part: string) => {
    const words = wordsOf(part);
    if (words.size) seen.push(words);
  };
  for (const line of said.flatMap((t) => t.split('\n'))) {
    remember(line);
    line.split(SENTENCE_END).forEach(remember);
  }
  const kept: string[] = [];
  for (const line of text.split('\n')) {
    if (!wordsOf(line).size) {
      kept.push(line);
      continue;
    }
    const sentences = line.split(SENTENCE_END);
    const fresh = sentences.filter((sentence) => {
      const words = wordsOf(sentence);
      if (!words.size) return true;
      if (seen.some((earlier) => repeats(words, earlier))) return false;
      seen.push(words);
      return true;
    });
    if (!fresh.some((sentence) => wordsOf(sentence).size)) continue;
    remember(line);
    kept.push(fresh.length === sentences.length ? line : fresh.join(' '));
  }
  return kept.join('\n');
}

/**
 * TM-22 / R5-6: the model sometimes writes the same sentence twice in one answer, or rewords it
 * (LM3-1). A sentence that repeats an earlier one is dropped (see {@link repeats}); blank lines
 * stay as they are.
 */
export function withoutRepeatedLines(text: string): string {
  return withoutRepeats(text, []);
}

/**
 * VL-B8 / R5-6: the final answer must not repeat what `send_message` already sent this turn: every
 * sentence of the answer that a sent message already said (or reworded) is dropped. Returns ''
 * when nothing new is left.
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
